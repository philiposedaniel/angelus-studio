import { sql } from '@payloadcms/db-postgres'
import type { Payload, PayloadRequest } from 'payload'

import type { Locale } from '@/i18n/config'
import { canCheckIn, type CheckInState } from '@/lib/checkIn'
import { checkFormToken, looksLikeSpam, senderKey } from '@/lib/inquiries'
import { advisoryLock } from '@/lib/advisoryLock'
import { idOf } from '@/lib/ids'
import { isShareToken } from '@/lib/shareTokens'
import { runSql } from '@/lib/sqlSession'
import {
  findPromoCode,
  normalizePromoCode,
  promoApplies,
  promoDiscount,
  promoPlacesUsed,
  PROMO_INVALID_STATUS,
  withinLimit,
} from '@/lib/promoCodes'
import { getStripe, stripeConfigured } from '@/lib/stripe'
import { holdsPlaces } from '@/lib/ticketHolds'
import type { Event, PromoCode, Registration, TicketType, User, WaitlistEntry } from '@/payload-types'

/** Most places one ticket type can hold, and most places one registration can take. */
export const MAX_TICKET_CAPACITY = 100_000
export const MAX_REGISTRATION_QUANTITY = 100
/** The default and the highest limit on places per public registration. */
export const DEFAULT_MAX_PER_ORDER = 10
export const MAX_PER_ORDER_LIMIT = 20

export const REGISTRATION_STATUSES = ['pending', 'confirmed', 'cancelled'] as const
export type RegistrationStatus = (typeof REGISTRATION_STATUSES)[number]

/** Registrations allowed per sender (network address) and per email address, per hour. */
export const MAX_REGISTRATIONS_PER_SENDER_PER_HOUR = 10
export const MAX_REGISTRATIONS_PER_EMAIL_PER_HOUR = 3

export const REGISTRATION_LIMITS = { name: 120, email: 200, phone: 40 } as const
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Error status the collection uses when a registration would go over a ticket type's capacity. */
export const SOLD_OUT_STATUS = 409

/**
 * How long places stay held for someone paying for a ticket. Stripe Checkout sessions last at
 * least 30 minutes; the session is set to expire a little before the hold ends, so a payment
 * completed in time always has its places.
 */
export const PAYMENT_HOLD_MS = 35 * 60 * 1000
export const CHECKOUT_EXPIRES_MS = 31 * 60 * 1000

/** Set by the Stripe webhook when a verified payment confirms a registration. */
export const PAID_TICKET_CONTEXT = { paidTicket: true } as const

export { holdsPlaces } from '@/lib/ticketHolds'

export const isWholeNumber = (value: unknown, min: number, max: number) =>
  typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max

/* ---- Capacity ---- */

// Keeps these advisory locks apart from any other use of advisory locks in the database.
const TICKET_LOCK_NAMESPACE = 7_301

/**
 * Holds a lock on one ticket type until the current database transaction ends, so two
 * registrations for the last places cannot both count the same free seats. Payload runs every
 * create and update in a transaction, so the hooks that check capacity call this first.
 */
export const lockTicketType = (req: PayloadRequest, ticketTypeId: number | string) =>
  advisoryLock(req, TICKET_LOCK_NAMESPACE, ticketTypeId)


/**
 * Places taken on a ticket type: confirmed registrations, those waiting for payment whose hold
 * has not run out, and places offered to people on the waitlist whose offer has not run out.
 * Leaves out one registration, or one waitlist offer, if given.
 */
export async function placesTaken(
  payload: Payload,
  ticketTypeId: number | string,
  {
    req,
    excludeId,
    excludeWaitlistId,
    now = Date.now(),
  }: { req?: PayloadRequest; excludeId?: number | string; excludeWaitlistId?: number | string; now?: number } = {},
) {
  // Summed in the database: this runs on every booking and event page view, and loading every
  // row of a large event took half a second. The query mirrors `holdsPlaces`.
  const moment = new Date(now).toISOString()
  const id = Number(ticketTypeId)
  const skipRegistration = excludeId === undefined ? null : Number(excludeId)
  const skipOffer = excludeWaitlistId === undefined ? null : Number(excludeWaitlistId)
  const [row] = await runSql<{ taken: string | null }>(
    payload,
    sql`SELECT
      COALESCE((SELECT SUM(quantity) FROM registrations
        WHERE ticket_type_id = ${id}
          AND (status = 'confirmed' OR (status = 'pending' AND hold_expires_at > ${moment}::timestamptz))
          AND (${skipRegistration}::int IS NULL OR id <> ${skipRegistration}::int)), 0)
      + COALESCE((SELECT SUM(quantity) FROM waitlist_entries
        WHERE ticket_type_id = ${id} AND status = 'offered' AND offer_expires_at > ${moment}::timestamptz
          AND (${skipOffer}::int IS NULL OR id <> ${skipOffer}::int)), 0) AS taken`,
    req,
  )
  return Number(row?.taken ?? 0)
}

/** People waiting for a ticket type, not yet offered places. */
export async function waitingCount(payload: Payload, ticketTypeId: number | string, req?: PayloadRequest) {
  const { totalDocs } = await payload.count({
    collection: 'waitlist-entries',
    where: { and: [{ ticketType: { equals: ticketTypeId } }, { status: { equals: 'waiting' } }] },
    overrideAccess: true,
    ...(req ? { req } : {}),
  })
  return totalDocs
}

/* ---- Sales ---- */

export type SalesState = 'onSale' | 'notYet' | 'ended' | 'soldOut' | 'closed'

/**
 * Whether a ticket type can be booked now on the website. While anyone is waiting on its
 * waitlist, freed places go to them first, so it stays sold out to everyone else.
 */
export function salesState(
  ticketType: Pick<TicketType, 'onSale' | 'salesStart' | 'salesEnd' | 'capacity'>,
  event: Pick<Event, 'startsAt' | 'endsAt'>,
  taken: number,
  now = Date.now(),
  waiting = 0,
): SalesState {
  if (ticketType.onSale === false) return 'closed'
  if (ticketType.salesStart && new Date(ticketType.salesStart).getTime() > now) return 'notYet'
  // Sales end at the end of sales, or else when the event is over.
  const end = ticketType.salesEnd ?? event.endsAt ?? event.startsAt
  if (end && new Date(end).getTime() < now) return 'ended'
  if (waiting > 0 || taken >= (ticketType.capacity ?? 0)) return 'soldOut'
  return 'onSale'
}

/* ---- Public registration ---- */

export type RegistrationField = 'ticketType' | 'quantity' | 'name' | 'email' | 'phone' | 'consent' | 'promoCode'
export type RegistrationFieldError = 'required' | 'invalid' | 'tooLong' | 'usedUp' | 'unknownCode'

export type RegistrationState =
  | { status: 'idle' }
  | { status: 'registered'; token: string; registrationId?: number }
  | { status: 'checkout'; url: string; registrationId?: number }
  | {
      status: 'error'
      errors?: Partial<Record<RegistrationField, RegistrationFieldError>>
      reason?: 'expired' | 'tooMany' | 'soldOut' | 'notEnough' | 'closed' | 'failed'
      remaining?: number
    }

export type RegistrationInput = {
  ticketType: number
  quantity: number
  name: string
  email: string
  phone?: string
  /** A promo code as typed, already in its stored form. */
  promoCode?: string
}

const text = (form: FormData, key: string) => {
  const value = form.get(key)
  return typeof value === 'string' ? value.trim() : ''
}

/** Checks what the visitor typed. The ticket type's own limits are checked by `submitRegistration`. */
export function validateRegistration(
  form: FormData,
):
  | { ok: true; input: RegistrationInput }
  | { ok: false; errors: Partial<Record<RegistrationField, RegistrationFieldError>> } {
  const errors: Partial<Record<RegistrationField, RegistrationFieldError>> = {}
  const ticketType = text(form, 'ticketType')
  const quantityText = text(form, 'quantity') || '1'
  const name = text(form, 'name')
  const email = text(form, 'email').toLowerCase()
  const phone = text(form, 'phone')
  const promoText = text(form, 'promoCode')
  const promoCode = promoText ? normalizePromoCode(promoText) : null

  if (!/^\d+$/.test(ticketType)) errors.ticketType = 'required'
  const quantity = /^\d+$/.test(quantityText) ? Number(quantityText) : NaN
  if (!isWholeNumber(quantity, 1, MAX_PER_ORDER_LIMIT)) errors.quantity = 'invalid'
  if (!name) errors.name = 'required'
  else if (name.length > REGISTRATION_LIMITS.name) errors.name = 'tooLong'
  if (!email) errors.email = 'required'
  else if (email.length > REGISTRATION_LIMITS.email || !EMAIL.test(email)) errors.email = 'invalid'
  if (phone.length > REGISTRATION_LIMITS.phone) errors.phone = 'tooLong'
  else if (phone && !/^[+\d][\d\s().-]{5,}$/.test(phone)) errors.phone = 'invalid'
  if (form.get('consent') !== 'on') errors.consent = 'required'
  if (promoText && !promoCode) errors.promoCode = 'unknownCode'

  if (Object.keys(errors).length > 0) return { ok: false, errors }
  return {
    ok: true,
    input: {
      ticketType: Number(ticketType),
      quantity,
      name,
      email,
      phone: phone || undefined,
      ...(promoCode ? { promoCode } : {}),
    },
  }
}

/** What a Stripe Checkout session for tickets needs; tests replace the call to Stripe. */
export type TicketCheckout = {
  email: string
  name: string
  currency: string
  unitAmount: number
  quantity: number
  metadata: Record<string, string>
  expiresAt: number
  successUrl: string
  cancelUrl: string
}

export type CreateTicketCheckout = (checkout: TicketCheckout) => Promise<{ id: string; url: string | null }>

const stripeTicketCheckout: CreateTicketCheckout = async (checkout) => {
  const session = await getStripe().checkout.sessions.create({
    mode: 'payment',
    // Cards and card wallets only: a delayed method such as a bank debit could be paid days
    // later, after the held places were given to someone else.
    allowed_payment_method_types: ['card'],
    customer_email: checkout.email,
    line_items: [
      {
        quantity: checkout.quantity,
        price_data: {
          currency: checkout.currency,
          unit_amount: checkout.unitAmount,
          product_data: { name: checkout.name.slice(0, 250) },
        },
      },
    ],
    metadata: checkout.metadata,
    expires_at: Math.floor(checkout.expiresAt / 1000),
    success_url: checkout.successUrl,
    cancel_url: checkout.cancelUrl,
  })
  return { id: session.id, url: session.url }
}

/** Whether a ticket type can be offered: free tickets always, paid ones once online payments are set up. */
export const canSell = (ticketType: Pick<TicketType, 'price'>) => (ticketType.price ?? 0) === 0 || stripeConfigured()

/**
 * Registers a visitor on a published event's page, after every check: the signed form token and
 * hidden field against bots, a limit per sender and per email, the ticket type being on sale for
 * this event, and places left. The collection's own hooks check capacity again under a lock, so
 * two people cannot take the last place. A free ticket is confirmed at once. A paid ticket holds
 * its places while the person pays through Stripe Checkout, and only the verified webhook
 * confirms it (src/lib/stripeWebhook.ts).
 */
export async function submitRegistration({
  payload,
  tenantId,
  eventId,
  locale,
  form,
  address,
  origin = '',
  createCheckout = stripeTicketCheckout,
  now = Date.now(),
}: {
  payload: Payload
  tenantId: number
  eventId: number
  locale: Locale
  form: FormData
  address: string | null
  /** The site's address, for Stripe to send the person back to. */
  origin?: string
  createCheckout?: CreateTicketCheckout
  now?: number
}): Promise<RegistrationState> {
  // Bots fill every field, including this one, which people never see. They learn nothing.
  if (text(form, 'website')) return { status: 'error', reason: 'failed' }

  const token = checkFormToken(form.get('formToken'), tenantId, now)
  if (token === 'expired' || token === 'invalid') return { status: 'error', reason: 'expired' }

  const result = validateRegistration(form)
  if (!result.ok) return { status: 'error', errors: result.errors }
  if (token === 'tooFast' || looksLikeSpam(result.input.name)) return { status: 'error', reason: 'failed' }
  const { input } = result

  // The ticket type must belong to this event, on this studio's site, and the event be public
  // (published and shown on the website, where its registration form is).
  const event = await payload
    .findByID({ collection: 'events', id: eventId, depth: 0, overrideAccess: true })
    .catch(() => null)
  if (!event || String(idOf(event.tenant)) !== String(tenantId) || !event.published || event.listed === false) {
    return { status: 'error', reason: 'closed' }
  }
  const ticketType = await payload
    .findByID({ collection: 'ticket-types', id: input.ticketType, depth: 0, overrideAccess: true })
    .catch(() => null)
  if (!ticketType || String(idOf(ticketType.event)) !== String(event.id)) {
    return { status: 'error', errors: { ticketType: 'required' } }
  }
  if (input.quantity > (ticketType.maxPerOrder ?? DEFAULT_MAX_PER_ORDER)) {
    return { status: 'error', errors: { quantity: 'invalid' } }
  }
  if (!canSell(ticketType)) return { status: 'error', reason: 'closed' }
  const taken = await placesTaken(payload, ticketType.id, { now })
  const state = salesState(ticketType, event, taken, now, await waitingCount(payload, ticketType.id))
  if (state === 'soldOut') return { status: 'error', reason: 'soldOut' }
  if (state !== 'onSale') return { status: 'error', reason: 'closed' }
  const remaining = (ticketType.capacity ?? 0) - taken
  if (input.quantity > remaining) return { status: 'error', reason: 'notEnough', remaining }

  const key = senderKey(address)
  const since = new Date(now - 60 * 60 * 1000).toISOString()
  const recent = async (field: 'senderKey' | 'email', value: string) =>
    (
      await payload.count({
        collection: 'registrations',
        where: {
          and: [
            { tenant: { equals: tenantId } },
            { [field]: { equals: value } },
            { createdAt: { greater_than: since } },
          ],
        },
        overrideAccess: true,
      })
    ).totalDocs
  if (
    (await recent('senderKey', key)) >= MAX_REGISTRATIONS_PER_SENDER_PER_HOUR ||
    (await recent('email', input.email)) >= MAX_REGISTRATIONS_PER_EMAIL_PER_HOUR
  ) {
    return { status: 'error', reason: 'tooMany' }
  }

  // A promo code must belong to this event, fit this ticket now and have places left at its price.
  let promo: PromoCode | null = null
  if (input.promoCode) {
    promo = await findPromoCode(payload, event.id, input.promoCode)
    if (!promo || !promoApplies(promo, ticketType, now)) return { status: 'error', errors: { promoCode: 'unknownCode' } }
    if (!withinLimit(promo, await promoPlacesUsed(payload, promo.id, { now }), input.quantity)) {
      return { status: 'error', errors: { promoCode: 'usedUp' } }
    }
  }

  return createRegistration({
    payload,
    tenantId,
    event,
    ticketType,
    input,
    locale,
    senderKey: key,
    origin,
    createCheckout,
    now,
    promo,
  })
}

/**
 * Saves a registration a visitor is entitled to, after the caller's checks: confirmed at once for
 * a free ticket, or waiting for payment and sent to Stripe Checkout for a paid one. A waitlist
 * claim passes the entry whose offered places it takes.
 */
export async function createRegistration({
  payload,
  tenantId,
  event,
  ticketType,
  input,
  locale,
  senderKey: key,
  origin,
  createCheckout = stripeTicketCheckout,
  now = Date.now(),
  waitlistEntryId,
  promo = null,
}: {
  payload: Payload
  tenantId: number
  event: Event
  ticketType: TicketType
  input: Omit<RegistrationInput, 'ticketType'>
  locale: Locale
  senderKey?: string | null
  origin: string
  createCheckout?: CreateTicketCheckout
  now?: number
  waitlistEntryId?: number
  /** A promo code the caller checked; the collection applies it again under a lock. */
  promo?: PromoCode | null
}): Promise<RegistrationState> {
  const price = ticketType.price ?? 0
  // A code that takes off the whole price makes the places free: confirmed at once, no payment.
  const paid = price * input.quantity - (promo ? promoDiscount(promo, price, input.quantity) : 0) > 0
  let created: Registration
  try {
    // System write: visitors have no create access; every check above stands in for it.
    created = await payload.create({
      collection: 'registrations',
      data: {
        ticketType: ticketType.id,
        event: event.id,
        name: input.name,
        email: input.email,
        phone: input.phone,
        quantity: input.quantity,
        language: locale,
        status: paid ? 'pending' : 'confirmed',
        holdExpiresAt: paid ? new Date(now + PAYMENT_HOLD_MS).toISOString() : null,
        senderKey: key,
        promoCode: promo?.id ?? null,
      },
      overrideAccess: true,
      ...(waitlistEntryId !== undefined ? { context: { waitlistEntryId } } : {}),
    })
    if (!isShareToken(created.ticketToken)) return { status: 'error', reason: 'failed' }
    // The collection prices the registration under its lock; if a promo code changed meanwhile,
    // what it charged decides, never the earlier guess.
    if (!paid && (created.amount ?? 0) > 0) {
      await payload.update({ collection: 'registrations', id: created.id, data: { status: 'cancelled' }, overrideAccess: true })
      return { status: 'error', reason: 'failed' }
    }
    if (paid && (created.amount ?? 0) === 0) {
      await payload.update({
        collection: 'registrations',
        id: created.id,
        data: { status: 'confirmed', holdExpiresAt: null },
        overrideAccess: true,
      })
      return { status: 'registered', token: created.ticketToken, registrationId: created.id }
    }
    if (!paid) return { status: 'registered', token: created.ticketToken, registrationId: created.id }
  } catch (error) {
    // A waitlist claim whose offer was taken or ran out (src/lib/waitlist.ts).
    if ((error as { status?: number }).status === 410) return { status: 'error', reason: 'closed' }
    if ((error as { status?: number }).status === PROMO_INVALID_STATUS) {
      return { status: 'error', errors: { promoCode: 'usedUp' } }
    }
    if ((error as { status?: number }).status === SOLD_OUT_STATUS) {
      const left = Math.max(0, (ticketType.capacity ?? 0) - (await placesTaken(payload, ticketType.id, { now })))
      return left === 0
        ? { status: 'error', reason: 'soldOut' }
        : { status: 'error', reason: 'notEnough', remaining: left }
    }
    payload.logger.error({ err: error, msg: 'Could not save a registration' })
    return { status: 'error', reason: 'failed' }
  }

  // Paid: send the person to Stripe. The amount comes from the stored registration, never the form.
  try {
    const checkout = await createCheckout({
      email: input.email,
      // With a discount the order is one line for its total, so Stripe charges exactly the stored amount.
      ...((created.discount ?? 0) > 0
        ? {
            name: `${ticketType.name} × ${input.quantity} · ${event.title}`,
            unitAmount: created.amount ?? 0,
            quantity: 1,
          }
        : { name: `${ticketType.name} · ${event.title}`, unitAmount: price, quantity: input.quantity }),
      currency: created.currency ?? ticketType.currency,
      metadata: { registrationId: String(created.id), tenantId: String(tenantId), kind: 'ticket' },
      expiresAt: now + CHECKOUT_EXPIRES_MS,
      successUrl: `${origin}/${locale}/tickets/${created.ticketToken}?payment=success`,
      cancelUrl: `${origin}/${locale}/events/${event.slug}?payment=cancelled#tickets`,
    })
    if (!checkout.url) throw new Error('Stripe returned no checkout address')
    await payload.create({
      collection: 'payments',
      data: {
        tenant: tenantId,
        registration: created.id,
        kind: 'ticket',
        amount: created.amount ?? 0,
        currency: created.currency ?? ticketType.currency,
        status: 'pending',
        stripeSessionId: checkout.id,
      },
      overrideAccess: true,
    })
    return { status: 'checkout', url: checkout.url, registrationId: created.id }
  } catch (error) {
    payload.logger.error({ err: error, msg: 'Could not start a ticket payment' })
    // Free the held places at once rather than when the hold runs out.
    await payload
      .update({ collection: 'registrations', id: created.id, data: { status: 'cancelled' }, overrideAccess: true })
      .catch(() => undefined)
    return { status: 'error', reason: 'failed' }
  }
}

/* ---- Tickets ---- */

/** The registration behind a ticket link, with its event and ticket type, on this studio's site. */
export async function findTicket(payload: Payload, tenantId: number, token: unknown, locale?: Locale) {
  if (!isShareToken(token)) return null
  const { docs } = await payload.find({
    collection: 'registrations',
    where: { and: [{ ticketToken: { equals: token } }, { tenant: { equals: tenantId } }] },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })
  const registration = docs[0]
  if (!registration) return null
  const [event, ticketType] = await Promise.all([
    payload
      .findByID({ collection: 'events', id: idOf(registration.event)!, depth: 0, overrideAccess: true, ...(locale ? { locale } : {}) })
      .catch(() => null),
    payload
      .findByID({
        collection: 'ticket-types',
        id: idOf(registration.ticketType)!,
        depth: 0,
        overrideAccess: true,
        ...(locale ? { locale } : {}),
      })
      .catch(() => null),
  ])
  // A ticket stops working when its event is unpublished.
  if (!event || !ticketType || !event.published) return null
  return { registration, event, ticketType }
}

/* ---- Summary ---- */

type SummaryRegistration = Pick<Registration, 'ticketType' | 'quantity' | 'status' | 'checkedInCount'> &
  Partial<Pick<Registration, 'holdExpiresAt'>>

/**
 * Per ticket type: places taken (confirmed, plus held for people paying now), places left,
 * places waiting for payment, people checked in and people on the waitlist.
 */
export function summarizeTickets(
  ticketTypes: readonly Pick<TicketType, 'id' | 'name' | 'capacity' | 'onSale'>[],
  registrations: readonly SummaryRegistration[],
  waitlist: readonly Pick<WaitlistEntry, 'ticketType' | 'status'>[] = [],
  now = Date.now(),
) {
  return ticketTypes.map((ticketType) => {
    const own = registrations.filter((r) => String(idOf(r.ticketType)) === String(ticketType.id))
    const queued = waitlist.filter(
      (w) => String(idOf(w.ticketType)) === String(ticketType.id) && (w.status === 'waiting' || w.status === 'offered'),
    )
    const confirmed = own.filter((r) => r.status === 'confirmed')
    const holding = own.filter((r) => holdsPlaces({ status: r.status, holdExpiresAt: r.holdExpiresAt ?? null }, now))
    const taken = holding.reduce((sum, r) => sum + (r.quantity ?? 0), 0)
    return {
      id: ticketType.id,
      name: ticketType.name,
      capacity: ticketType.capacity ?? 0,
      taken,
      left: Math.max(0, (ticketType.capacity ?? 0) - taken),
      registrations: confirmed.length,
      waiting: holding.filter((r) => r.status === 'pending').reduce((sum, r) => sum + (r.quantity ?? 0), 0),
      arrived: confirmed.reduce((sum, r) => sum + (r.checkedInCount ?? 0), 0),
      onWaitlist: queued.length,
      onSale: ticketType.onSale !== false,
    }
  })
}

/* ---- Event page ---- */

export type TicketOffer = {
  id: number
  name: string
  description: string | null
  price: number
  currency: string
  state: SalesState
  left: number
  maxPerOrder: number
  salesStart: string | null
  /** People on the waitlist who have not been offered places yet. */
  waiting: number
}

/**
 * The ticket types an event page shows, each with whether it can be booked now and places left.
 * A sold-out ticket can be joined on its waitlist. Waitlists are brought up to date first, since
 * holds and offers run out with time.
 */
export async function ticketOffers(
  payload: Payload,
  event: Event,
  locale: Locale,
  now = Date.now(),
  // Passed in by the caller: the waitlist module builds on this one, so it is not imported here.
  refresh?: (ticketTypeId: number, now: number) => Promise<void>,
) {
  const { docs } = await payload.find({
    collection: 'ticket-types',
    where: { and: [{ event: { equals: event.id } }, { tenant: { equals: idOf(event.tenant) } }] },
    sort: 'sortOrder',
    pagination: false,
    depth: 0,
    locale,
    overrideAccess: true,
  })
  return Promise.all(
    docs.map(async (ticketType): Promise<TicketOffer> => {
      if (refresh) await refresh(ticketType.id, now)
      const taken = await placesTaken(payload, ticketType.id, { now })
      const waiting = await waitingCount(payload, ticketType.id)
      const state = canSell(ticketType) ? salesState(ticketType, event, taken, now, waiting) : 'closed'
      return {
        id: ticketType.id,
        name: ticketType.name,
        description: ticketType.description ?? null,
        price: ticketType.price ?? 0,
        currency: ticketType.currency ?? 'eur',
        state,
        left: Math.max(0, (ticketType.capacity ?? 0) - taken),
        maxPerOrder: ticketType.maxPerOrder ?? DEFAULT_MAX_PER_ORDER,
        salesStart: ticketType.salesStart ?? null,
        waiting,
      }
    }),
  )
}

/* ---- Check-in ---- */

/**
 * Records how many people on a ticket have arrived, from its entry code. Zero undoes the
 * check-in. Only the studio's guest-list staff may, and the save runs as them, so the
 * collection's access rules apply too. A cancelled registration cannot be checked in.
 */
export async function checkInTicket({
  payload,
  user,
  tenantId,
  form,
}: {
  payload: Payload
  user: User | null
  tenantId: number
  form: FormData
}): Promise<CheckInState> {
  if (!user || !canCheckIn(user, tenantId)) return { status: 'error', reason: 'forbidden' }
  const found = await findTicket(payload, tenantId, form.get('token'))
  if (!found || found.registration.status !== 'confirmed') return { status: 'error', reason: 'invalid' }

  const raw = form.get('count')
  const count = typeof raw === 'string' && /^\d+$/.test(raw) ? Number(raw) : NaN
  const quantity = found.registration.quantity ?? 1
  if (!Number.isInteger(count) || count < 0 || count > quantity) return { status: 'error', reason: 'invalid' }

  try {
    await payload.update({
      collection: 'registrations',
      id: found.registration.id,
      data: { checkedInCount: count },
      user,
      overrideAccess: false,
    })
  } catch (error) {
    payload.logger.error({ err: error, msg: 'Could not check a ticket in' })
    return { status: 'error', reason: 'failed' }
  }
  return { status: 'saved', count }
}
