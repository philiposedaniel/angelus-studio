import { getPayload, type Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { idOf } from '@/lib/ids'
import { issueFormToken, MIN_FILL_MS } from '@/lib/inquiries'
import { getStripe } from '@/lib/stripe'
import { handleStripeWebhook } from '@/lib/stripeWebhook'
import {
  CHECKOUT_EXPIRES_MS,
  PAYMENT_HOLD_MS,
  placesTaken,
  submitRegistration,
  ticketOffers,
  type TicketCheckout,
} from '@/lib/tickets'
import config from '@/payload.config'
import type { Event, Tenant, TicketType } from '@/payload-types'

import { ensureTenant } from '../helpers/seedTenant'

const PREFIX = 'int-paidtix-'
const SECRET = 'whsec_int_paid_tickets'
const NOW = Date.now()
const DAY = 86_400_000
const originalSecrets = { key: process.env.STRIPE_SECRET_KEY, webhook: process.env.STRIPE_WEBHOOK_SECRET }

let payload: Payload
let studio: Tenant
let event: Event
let counter = 0
/** Every checkout the website asked Stripe for, in place of calling Stripe. */
const checkouts: TicketCheckout[] = []

/** The Stripe session id the fake handed out last. */
let lastSession = ''

const fakeCheckout = async (checkout: TicketCheckout) => {
  checkouts.push(checkout)
  lastSession = `${PREFIX}cs_${++counter}`
  return { id: lastSession, url: `https://checkout.stripe.test/${counter}` }
}

const makeTicketType = (extra: Record<string, unknown> = {}) =>
  payload.create({
    collection: 'ticket-types',
    data: { event: event.id, name: `${PREFIX}Gala`, capacity: 10, maxPerOrder: 5, price: 2500, currency: 'eur', ...extra } as never,
    overrideAccess: true,
  })

const filled = (ticketType: TicketType, overrides: Record<string, string> = {}) => {
  const data = new FormData()
  const values: Record<string, string> = {
    formToken: issueFormToken(studio.id, NOW - MIN_FILL_MS - 1000),
    ticketType: String(ticketType.id),
    quantity: '2',
    name: 'Maria Silva',
    email: `${PREFIX}buyer${++counter}@example.com`,
    consent: 'on',
    ...overrides,
  }
  for (const [key, value] of Object.entries(values)) data.set(key, value)
  return data
}

const register = (form: FormData, now = NOW) =>
  submitRegistration({
    payload,
    tenantId: studio.id,
    eventId: event.id,
    locale: 'en',
    form,
    address: `192.0.2.${++counter % 250}`,
    origin: 'https://studio.test',
    createCheckout: fakeCheckout,
    now,
  })

/** Sends a webhook the way Stripe does: JSON body, signed with the webhook secret. */
const send = (type: string, object: Record<string, unknown>) => {
  const body = JSON.stringify({ id: `evt_${PREFIX}${++counter}`, object: 'event', type, data: { object } })
  const signature = getStripe().webhooks.generateTestHeaderString({ payload: body, secret: SECRET })
  return handleStripeWebhook(
    new Request('http://localhost/api/stripe/webhook', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'stripe-signature': signature },
      body,
    }),
  )
}

const paymentFor = async (sessionId: string) =>
  (await payload.find({ collection: 'payments', where: { stripeSessionId: { equals: sessionId } }, overrideAccess: true }))
    .docs[0]!

const cleanup = async () => {
  await payload.delete({ collection: 'payments', where: { stripeSessionId: { like: PREFIX } }, overrideAccess: true })
  await payload.delete({ collection: 'events', where: { slug: { like: PREFIX } }, overrideAccess: true })
}

describe('paid tickets', () => {
  beforeAll(async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_int_placeholder'
    process.env.STRIPE_WEBHOOK_SECRET = SECRET
    payload = await getPayload({ config: await config })
    studio = await ensureTenant(payload, { name: 'Int Studio A', slug: 'int-studio-a' })
    await cleanup()
    event = await payload.create({
      collection: 'events',
      data: {
        tenant: studio.id,
        title: `${PREFIX}Gala night`,
        slug: `${PREFIX}gala`,
        startsAt: new Date(NOW + 30 * DAY).toISOString(),
        timeZone: 'Europe/Lisbon',
        published: true,
        listed: true,
      } as never,
      overrideAccess: true,
    })
  })

  afterAll(async () => {
    await cleanup()
    process.env.STRIPE_SECRET_KEY = originalSecrets.key
    process.env.STRIPE_WEBHOOK_SECRET = originalSecrets.webhook
  })

  it('holds the places and sends the buyer to Stripe for the stored price', async () => {
    const ticketType = await makeTicketType()
    const result = await register(filled(ticketType, { quantity: '2' }))
    expect(result).toEqual({ status: 'checkout', url: expect.stringMatching(/^https:\/\/checkout\.stripe\.test\//) })
    const checkout = checkouts[checkouts.length - 1]!
    expect(checkout).toMatchObject({ unitAmount: 2500, quantity: 2, currency: 'eur', metadata: { kind: 'ticket' } })
    expect(checkout.expiresAt).toBe(NOW + CHECKOUT_EXPIRES_MS)
    expect(checkout.successUrl).toMatch(/^https:\/\/studio\.test\/en\/tickets\/[A-Za-z0-9_-]{32}\?payment=success$/)

    const registration = await payload.findByID({
      collection: 'registrations',
      id: Number(checkout.metadata.registrationId),
      overrideAccess: true,
    })
    expect(registration).toMatchObject({ status: 'pending', amount: 5000, currency: 'eur' })
    expect(new Date(registration.holdExpiresAt!).getTime()).toBe(NOW + PAYMENT_HOLD_MS)
    // Held places count while the hold lasts, and are free again after it.
    expect(await placesTaken(payload, ticketType.id, { now: NOW })).toBe(2)
    expect(await placesTaken(payload, ticketType.id, { now: NOW + PAYMENT_HOLD_MS + 1 })).toBe(0)
  })

  it('confirms the ticket only when a signed, paid, matching session arrives, once', async () => {
    const ticketType = await makeTicketType()
    await register(filled(ticketType, { quantity: '2' }))
    const checkout = checkouts[checkouts.length - 1]!
    const sessionId = lastSession
    const payment = await paymentFor(sessionId)
    expect(payment).toMatchObject({ kind: 'ticket', amount: 5000, status: 'pending' })
    const registrationId = Number(checkout.metadata.registrationId)

    // A session not yet paid confirms nothing.
    await send('checkout.session.completed', { id: sessionId, object: 'checkout.session', payment_status: 'unpaid', amount_total: 5000, currency: 'eur', metadata: {} })
    expect((await payload.findByID({ collection: 'registrations', id: registrationId, overrideAccess: true })).status).toBe('pending')

    const paid = { id: sessionId, object: 'checkout.session', payment_status: 'paid', amount_total: 5000, currency: 'eur', metadata: {} }
    expect((await send('checkout.session.completed', paid)).status).toBe(200)
    const confirmed = await payload.findByID({ collection: 'registrations', id: registrationId, overrideAccess: true })
    expect(confirmed).toMatchObject({ status: 'confirmed', holdExpiresAt: null })
    expect((await paymentFor(sessionId)).status).toBe('paid')
    // The same event again changes nothing.
    expect(await (await send('checkout.session.completed', paid)).json()).toMatchObject({ duplicate: true })
  })

  it('refuses a payment that does not match the ticket', async () => {
    const ticketType = await makeTicketType()
    await register(filled(ticketType, { quantity: '1' }))
    const sessionId = lastSession
    const registrationId = idOf((await paymentFor(sessionId)).registration)!
    await send('checkout.session.completed', { id: sessionId, object: 'checkout.session', payment_status: 'paid', amount_total: 100, currency: 'eur', metadata: {} })
    expect((await paymentFor(sessionId)).status).toBe('failed')
    expect((await payload.findByID({ collection: 'registrations', id: registrationId, overrideAccess: true })).status).toBe('pending')
  })

  it('confirms a late payment even after the hold ran out and the places were taken', async () => {
    const ticketType = await makeTicketType({ capacity: 2 })
    await register(filled(ticketType, { quantity: '2' }))
    const sessionId = lastSession
    const registrationId = idOf((await paymentFor(sessionId)).registration)!
    // The hold runs out and someone else takes the places.
    await payload.update({
      collection: 'registrations',
      id: registrationId,
      data: { holdExpiresAt: new Date(Date.now() - 1000).toISOString() },
      overrideAccess: true,
    })
    await payload.create({
      collection: 'registrations',
      data: { ticketType: ticketType.id, name: 'Walk-in', email: `${PREFIX}walkin@example.com`, quantity: 2 } as never,
      overrideAccess: true,
    })
    await send('checkout.session.completed', { id: sessionId, object: 'checkout.session', payment_status: 'paid', amount_total: 5000, currency: 'eur', metadata: {} })
    expect((await payload.findByID({ collection: 'registrations', id: registrationId, overrideAccess: true })).status).toBe('confirmed')
  })

  it('releases the places when the checkout expires unpaid', async () => {
    const ticketType = await makeTicketType({ capacity: 2 })
    await register(filled(ticketType, { quantity: '2' }))
    const sessionId = lastSession
    const registrationId = idOf((await paymentFor(sessionId)).registration)!
    expect(await register(filled(ticketType, { quantity: '1' }))).toMatchObject({ reason: 'soldOut' })

    await send('checkout.session.expired', { id: sessionId, object: 'checkout.session', payment_status: 'unpaid', metadata: {} })
    expect((await payload.findByID({ collection: 'registrations', id: registrationId, overrideAccess: true })).status).toBe('cancelled')
    expect((await paymentFor(sessionId)).status).toBe('expired')
    expect((await register(filled(ticketType, { quantity: '1' }))).status).toBe('checkout')
  })

  it('frees the places at once when Stripe cannot start the payment', async () => {
    const ticketType = await makeTicketType({ capacity: 2 })
    const failing = await submitRegistration({
      payload,
      tenantId: studio.id,
      eventId: event.id,
      locale: 'en',
      form: filled(ticketType, { quantity: '2' }),
      address: '192.0.2.200',
      createCheckout: async () => {
        throw new Error('Stripe is down')
      },
      now: NOW,
    })
    expect(failing).toMatchObject({ reason: 'failed' })
    expect(await placesTaken(payload, ticketType.id, { now: NOW })).toBe(0)
  })

  it('offers paid tickets only once online payments are set up, and keeps the price fixed', async () => {
    const ticketType = await makeTicketType()
    process.env.STRIPE_SECRET_KEY = ''
    try {
      const offers = await ticketOffers(payload, event, 'en', NOW)
      expect(offers.find((o) => o.id === ticketType.id)?.state).toBe('closed')
      expect(await register(filled(ticketType))).toMatchObject({ reason: 'closed' })
    } finally {
      process.env.STRIPE_SECRET_KEY = 'sk_test_int_placeholder'
    }
    await register(filled(ticketType, { quantity: '1' }))
    await expect(
      payload.update({ collection: 'ticket-types', id: ticketType.id, data: { price: 100 }, overrideAccess: true }),
    ).rejects.toThrow(/price cannot change/)
  })

  it('never lets a payment belong to nothing, or to two things', async () => {
    await expect(
      payload.create({
        collection: 'payments',
        data: { tenant: studio.id, kind: 'ticket', amount: 100, currency: 'eur', stripeSessionId: `${PREFIX}orphan` } as never,
        overrideAccess: true,
      }),
    ).rejects.toThrow(/quote, or for a ticket/)
  })
})
