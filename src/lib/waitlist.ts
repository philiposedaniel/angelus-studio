import { commitTransaction, createLocalReq, killTransaction, type Payload, type PayloadRequest } from 'payload'

import type { Locale } from '@/i18n/config'
import { idOf } from '@/lib/ids'
import { checkFormToken, looksLikeSpam, senderKey } from '@/lib/inquiries'
import { isShareToken } from '@/lib/shareTokens'
import {
  canSell,
  createRegistration,
  lockTicketType,
  placesTaken,
  salesState,
  validateRegistration,
  waitingCount,
  type CreateTicketCheckout,
  type RegistrationField,
  type RegistrationFieldError,
  type RegistrationState,
} from '@/lib/tickets'
import type { Event, TicketType, WaitlistEntry } from '@/payload-types'

export const WAITLIST_STATUSES = ['waiting', 'offered', 'claimed', 'expired', 'left', 'removed'] as const
export type WaitlistStatus = (typeof WAITLIST_STATUSES)[number]

/** How long places offered to someone on the waitlist are held for them. */
export const WAITLIST_OFFER_MS = 24 * 60 * 60 * 1000

/** Joins allowed per sender (network address) and per email address, per hour. */
export const MAX_WAITLIST_JOINS_PER_SENDER_PER_HOUR = 10
export const MAX_WAITLIST_JOINS_PER_EMAIL_PER_HOUR = 3

/** Marks the waitlist's own status changes, which staff cannot make by hand. */
const WAITLIST_SYSTEM_CONTEXT = { waitlistSystem: true } as const
/** Marks changes made while refreshing a waitlist, which must not start another refresh. */
const WAITLIST_REFRESH_CONTEXT = { waitlistSystem: true, waitlistRefresh: true } as const
export const isWaitlistSystem = (context: unknown) =>
  (context as Record<string, unknown> | undefined)?.waitlistSystem === true
export const isWaitlistRefresh = (context: unknown) =>
  (context as Record<string, unknown> | undefined)?.waitlistRefresh === true

/**
 * Brings a ticket type's waitlist up to date: offers that ran out are closed, then free places
 * are offered to the people waiting, strictly in the order they joined, while the ticket is on
 * sale. Runs under the ticket type's lock, so it never offers the same places twice. Called when
 * places are given back, and when the event page or a waitlist link is opened (holds and offers
 * run out with time, not with a change anyone makes).
 */
export async function refreshWaitlist(
  payload: Payload,
  ticketTypeId: number | string,
  { req, now = Date.now() }: { req?: PayloadRequest; now?: number } = {},
): Promise<void> {
  if (!req) {
    // Opened outside any change: run in a transaction of our own, so the lock holds until it ends.
    const own = await createLocalReq({}, payload)
    own.transactionID = (await payload.db.beginTransaction()) ?? undefined
    try {
      await refreshWaitlist(payload, ticketTypeId, { req: own, now })
      await commitTransaction(own)
    } catch (error) {
      await killTransaction(own)
      payload.logger.error({ err: error, msg: 'Could not update a waitlist' })
    }
    return
  }

  // Payload keeps the context of a change on its request, which may be the caller's: put it back after.
  const callerContext = req.context
  try {
    await offerFreedPlaces(payload, ticketTypeId, req, now)
  } finally {
    req.context = callerContext
  }
}

async function offerFreedPlaces(payload: Payload, ticketTypeId: number | string, req: PayloadRequest, now: number) {
  const { totalDocs } = await payload.count({
    collection: 'waitlist-entries',
    where: { and: [{ ticketType: { equals: ticketTypeId } }, { status: { in: ['waiting', 'offered'] } }] },
    req,
    overrideAccess: true,
  })
  if (totalDocs === 0) return

  await lockTicketType(req, ticketTypeId)
  const system = { req, overrideAccess: true, context: WAITLIST_REFRESH_CONTEXT } as const
  await payload.update({
    collection: 'waitlist-entries',
    where: {
      and: [
        { ticketType: { equals: ticketTypeId } },
        { status: { equals: 'offered' } },
        { offerExpiresAt: { less_than_equal: new Date(now).toISOString() } },
      ],
    },
    data: { status: 'expired' },
    ...system,
  })

  const ticketType = await payload
    .findByID({ collection: 'ticket-types', id: ticketTypeId, depth: 0, req, overrideAccess: true })
    .catch(() => null)
  if (!ticketType || ticketType.onSale === false) return
  const event = await payload
    .findByID({ collection: 'events', id: idOf(ticketType.event)!, depth: 0, req, overrideAccess: true })
    .catch(() => null)
  if (!event) return
  // Nothing is offered once registration has closed.
  const state = salesState(ticketType, event, 0, now)
  if (state === 'ended' || state === 'closed' || state === 'notYet') return

  let free = (ticketType.capacity ?? 0) - (await placesTaken(payload, ticketTypeId, { req, now }))
  if (free <= 0) return
  const { docs: waiting } = await payload.find({
    collection: 'waitlist-entries',
    where: { and: [{ ticketType: { equals: ticketTypeId } }, { status: { equals: 'waiting' } }] },
    sort: 'createdAt',
    pagination: false,
    depth: 0,
    req,
    overrideAccess: true,
  })
  for (const entry of waiting) {
    // First come, first served: if the next person needs more places than are free, everyone waits.
    if ((entry.quantity ?? 1) > free) break
    await payload.update({
      collection: 'waitlist-entries',
      id: entry.id,
      data: { status: 'offered', offerExpiresAt: new Date(now + WAITLIST_OFFER_MS).toISOString() },
      ...system,
    })
    free -= entry.quantity ?? 1
  }
}

/* ---- Joining ---- */

export type WaitlistJoinState =
  | { status: 'idle' }
  | { status: 'joined'; token: string }
  | {
      status: 'error'
      errors?: Partial<Record<RegistrationField, RegistrationFieldError>>
      reason?: 'expired' | 'tooMany' | 'closed' | 'already' | 'failed'
    }

/**
 * Puts a visitor on a sold-out ticket's waitlist from the event page, with the same protection
 * as registering, and returns their private waitlist link.
 */
export async function joinWaitlist({
  payload,
  tenantId,
  eventId,
  locale,
  form,
  address,
  now = Date.now(),
}: {
  payload: Payload
  tenantId: number
  eventId: number
  locale: Locale
  form: FormData
  address: string | null
  now?: number
}): Promise<WaitlistJoinState> {
  if (typeof form.get('website') === 'string' && String(form.get('website')).trim()) {
    return { status: 'error', reason: 'failed' }
  }
  const token = checkFormToken(form.get('formToken'), tenantId, now)
  if (token === 'expired' || token === 'invalid') return { status: 'error', reason: 'expired' }
  const result = validateRegistration(form)
  if (!result.ok) return { status: 'error', errors: result.errors }
  if (token === 'tooFast' || looksLikeSpam(result.input.name)) return { status: 'error', reason: 'failed' }
  const { input } = result

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
  if (input.quantity > (ticketType.maxPerOrder ?? 1)) return { status: 'error', errors: { quantity: 'invalid' } }
  // Only a ticket that is sold out, and still selling, has a waitlist.
  const taken = await placesTaken(payload, ticketType.id, { now })
  const state = canSell(ticketType)
    ? salesState(ticketType, event, taken, now, await waitingCount(payload, ticketType.id))
    : 'closed'
  if (state !== 'soldOut') return { status: 'error', reason: 'closed' }

  const { totalDocs: already } = await payload.count({
    collection: 'waitlist-entries',
    where: {
      and: [
        { ticketType: { equals: ticketType.id } },
        { email: { equals: input.email } },
        { status: { in: ['waiting', 'offered'] } },
      ],
    },
    overrideAccess: true,
  })
  if (already > 0) return { status: 'error', reason: 'already' }

  const key = senderKey(address)
  const since = new Date(now - 60 * 60 * 1000).toISOString()
  const recent = async (field: 'senderKey' | 'email', value: string) =>
    (
      await payload.count({
        collection: 'waitlist-entries',
        where: {
          and: [{ tenant: { equals: tenantId } }, { [field]: { equals: value } }, { createdAt: { greater_than: since } }],
        },
        overrideAccess: true,
      })
    ).totalDocs
  if (
    (await recent('senderKey', key)) >= MAX_WAITLIST_JOINS_PER_SENDER_PER_HOUR ||
    (await recent('email', input.email)) >= MAX_WAITLIST_JOINS_PER_EMAIL_PER_HOUR
  ) {
    return { status: 'error', reason: 'tooMany' }
  }

  try {
    // System write: visitors have no create access; every check above stands in for it.
    const entry = await payload.create({
      collection: 'waitlist-entries',
      data: {
        ticketType: ticketType.id,
        event: event.id,
        name: input.name,
        email: input.email,
        phone: input.phone,
        quantity: input.quantity,
        language: locale,
        status: 'waiting',
        senderKey: key,
      },
      overrideAccess: true,
    })
    // Places may have freed up in the meantime; if so they are offered at once.
    await refreshWaitlist(payload, ticketType.id, { now })
    if (!isShareToken(entry.claimToken)) return { status: 'error', reason: 'failed' }
    return { status: 'joined', token: entry.claimToken }
  } catch (error) {
    payload.logger.error({ err: error, msg: 'Could not add someone to a waitlist' })
    return { status: 'error', reason: 'failed' }
  }
}

/* ---- The waitlist link ---- */

/** The waitlist entry behind a link, with its event and ticket type, on this studio's site. */
export async function findWaitlistEntry(payload: Payload, tenantId: number, token: unknown, locale?: Locale) {
  if (!isShareToken(token)) return null
  const { docs } = await payload.find({
    collection: 'waitlist-entries',
    where: { and: [{ claimToken: { equals: token } }, { tenant: { equals: tenantId } }] },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })
  const entry = docs[0]
  if (!entry) return null
  const [event, ticketType] = await Promise.all([
    payload
      .findByID({ collection: 'events', id: idOf(entry.event)!, depth: 0, overrideAccess: true, ...(locale ? { locale } : {}) })
      .catch(() => null),
    payload
      .findByID({
        collection: 'ticket-types',
        id: idOf(entry.ticketType)!,
        depth: 0,
        overrideAccess: true,
        ...(locale ? { locale } : {}),
      })
      .catch(() => null),
  ])
  if (!event || !ticketType || !event.published) return null
  return { entry, event, ticketType }
}

/** Whether places are being held for this person now. */
export const offerOpen = (entry: Pick<WaitlistEntry, 'status' | 'offerExpiresAt'>, now = Date.now()) =>
  entry.status === 'offered' && Boolean(entry.offerExpiresAt) && new Date(entry.offerExpiresAt!).getTime() > now

/** Where someone waiting stands: 1 is next in line. */
export async function waitlistPosition(payload: Payload, entry: Pick<WaitlistEntry, 'ticketType' | 'createdAt'>) {
  const { totalDocs } = await payload.count({
    collection: 'waitlist-entries',
    where: {
      and: [
        { ticketType: { equals: idOf(entry.ticketType) } },
        { status: { equals: 'waiting' } },
        { createdAt: { less_than: entry.createdAt } },
      ],
    },
    overrideAccess: true,
  })
  return totalDocs + 1
}

/**
 * Claims the places offered to someone on the waitlist, with their link: a registration is
 * made in their name for the places they asked for, free or paid like any other, using the
 * places held for them. The entry is marked claimed only once that registration exists.
 */
export async function claimWaitlistPlaces({
  payload,
  tenantId,
  token,
  origin,
  createCheckout,
  now = Date.now(),
}: {
  payload: Payload
  tenantId: number
  token: unknown
  origin: string
  createCheckout?: CreateTicketCheckout
  now?: number
}): Promise<RegistrationState> {
  const found = await findWaitlistEntry(payload, tenantId, token)
  if (!found) return { status: 'error', reason: 'closed' }
  await refreshWaitlist(payload, found.ticketType.id, { now })
  const entry = await payload.findByID({ collection: 'waitlist-entries', id: found.entry.id, depth: 0, overrideAccess: true })
  if (!offerOpen(entry, now) || !canSell(found.ticketType)) return { status: 'error', reason: 'closed' }

  const result = await createRegistration({
    payload,
    tenantId,
    event: found.event as Event,
    ticketType: found.ticketType as TicketType,
    input: { name: entry.name, email: entry.email, phone: entry.phone ?? undefined, quantity: entry.quantity ?? 1 },
    locale: entry.language as Locale,
    origin,
    createCheckout,
    now,
    waitlistEntryId: entry.id,
  })
  if (result.status === 'registered' || result.status === 'checkout') {
    await payload.update({
      collection: 'waitlist-entries',
      id: entry.id,
      data: { status: 'claimed', registration: result.registrationId },
      overrideAccess: true,
      context: WAITLIST_SYSTEM_CONTEXT,
    })
  }
  return result
}

/** Takes someone off the waitlist with their own link; places offered to them go to the next person. */
export async function leaveWaitlist({ payload, tenantId, token }: { payload: Payload; tenantId: number; token: unknown }) {
  const found = await findWaitlistEntry(payload, tenantId, token)
  if (!found || !['waiting', 'offered'].includes(found.entry.status)) return false
  await payload.update({
    collection: 'waitlist-entries',
    id: found.entry.id,
    data: { status: 'left' },
    overrideAccess: true,
    context: WAITLIST_SYSTEM_CONTEXT,
  })
  return true
}
