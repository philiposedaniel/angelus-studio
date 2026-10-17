import { createLocalReq, getPayload, type Payload, type PayloadRequest } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { idOf } from '@/lib/ids'
import { issueFormToken, MIN_FILL_MS } from '@/lib/inquiries'
import { getStripe } from '@/lib/stripe'
import { handleStripeWebhook } from '@/lib/stripeWebhook'
import { refundTicket, refundTicketEndpoint, type TicketRefundRequest, type TicketRefunds } from '@/lib/ticketRefunds'
import { placesTaken, submitRegistration } from '@/lib/tickets'
import config from '@/payload.config'
import type { Event, Payment, Registration, Tenant, TicketType, User } from '@/payload-types'

import { ensureTenant } from '../helpers/seedTenant'

const PREFIX = 'int-refunds-'
const SECRET = 'whsec_int_refunds'
const password = 'int-Password-1'
const NOW = Date.now()
const originalSecrets = { key: process.env.STRIPE_SECRET_KEY, webhook: process.env.STRIPE_WEBHOOK_SECRET }

let payload: Payload
let studioA: Tenant
let studioB: Tenant
let adminA: User
let managerA: User
let adminB: User
let event: Event
let counter = 0

/** Every refund asked of Stripe, in place of calling Stripe. */
const refunds: TicketRefundRequest[] = []
const lookups: string[] = []
const fakeStripe: TicketRefunds = {
  paymentIntentFor: async (sessionId) => {
    lookups.push(sessionId)
    return `pi_${PREFIX}looked_up_${++counter}`
  },
  createRefund: async (request) => {
    refunds.push(request)
    return { id: `re_${PREFIX}${++counter}` }
  },
}

const makeUser = async (name: string, tenant: Tenant, roles: string[]) => {
  const created = await payload.create({
    collection: 'users',
    data: {
      email: `${PREFIX}${name}@angelus.test`,
      password,
      roles: ['user'],
      tenants: [{ tenant: tenant.id, roles: roles as never }],
    },
  })
  return payload.findByID({ collection: 'users', id: created.id, depth: 0 })
}

/** Sends a webhook the way Stripe does: JSON body, signed with the webhook secret. */
const send = (type: string, object: Record<string, unknown>, id = `evt_${PREFIX}${++counter}`) => {
  const body = JSON.stringify({ id, object: 'event', type, data: { object } })
  const signature = getStripe().webhooks.generateTestHeaderString({ payload: body, secret: SECRET })
  return handleStripeWebhook(
    new Request('http://localhost/api/stripe/webhook', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'stripe-signature': signature },
      body,
    }),
  )
}

/** A ticket bought and paid for online: returns its registration, payment and Stripe payment id. */
const buyTicket = async (ticketType: TicketType, { storeIntent = true } = {}) => {
  let sessionId = ''
  const form = new FormData()
  const values: Record<string, string> = {
    formToken: issueFormToken(studioA.id, NOW - MIN_FILL_MS - 1000),
    ticketType: String(ticketType.id),
    quantity: '2',
    name: 'Maria Silva',
    email: `${PREFIX}buyer${++counter}@example.com`,
    consent: 'on',
  }
  for (const [key, value] of Object.entries(values)) form.set(key, value)
  await submitRegistration({
    payload,
    tenantId: studioA.id,
    eventId: event.id,
    locale: 'en',
    form,
    address: `192.0.2.${++counter % 250}`,
    origin: 'https://studio.test',
    createCheckout: async () => {
      sessionId = `cs_${PREFIX}${++counter}`
      return { id: sessionId, url: `https://checkout.stripe.test/${counter}` }
    },
  })
  const paymentIntent = `pi_${PREFIX}${++counter}`
  await send('checkout.session.completed', {
    id: sessionId,
    object: 'checkout.session',
    payment_status: 'paid',
    amount_total: 5000,
    currency: 'eur',
    metadata: {},
    ...(storeIntent ? { payment_intent: paymentIntent } : {}),
  })
  const payment = (await payload.find({ collection: 'payments', where: { stripeSessionId: { equals: sessionId } }, overrideAccess: true }))
    .docs[0]!
  const registration = await payload.findByID({ collection: 'registrations', id: idOf(payment.registration)!, overrideAccess: true })
  return { payment, registration, paymentIntent, sessionId }
}

const reload = async (payment: Payment, registration: Registration) => ({
  payment: await payload.findByID({ collection: 'payments', id: payment.id, overrideAccess: true }),
  registration: await payload.findByID({ collection: 'registrations', id: registration.id, overrideAccess: true }),
})

const makeTicketType = () =>
  payload.create({
    collection: 'ticket-types',
    data: { event: event.id, name: `${PREFIX}Gala`, capacity: 10, maxPerOrder: 5, price: 2500, currency: 'eur' } as never,
    overrideAccess: true,
  })

const cleanup = async () => {
  await payload.delete({ collection: 'payments', where: { stripeSessionId: { like: PREFIX } }, overrideAccess: true })
  await payload.delete({ collection: 'events', where: { slug: { like: PREFIX } }, overrideAccess: true })
  await payload.delete({ collection: 'users', where: { email: { like: PREFIX } } })
}

describe('ticket refunds', () => {
  beforeAll(async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_int_placeholder'
    process.env.STRIPE_WEBHOOK_SECRET = SECRET
    payload = await getPayload({ config: await config })
    studioA = await ensureTenant(payload, { name: 'Int Studio A', slug: 'int-studio-a' })
    studioB = await ensureTenant(payload, { name: 'Int Studio B', slug: 'int-studio-b' })
    await cleanup()
    adminA = await makeUser('admin-a', studioA, ['admin'])
    managerA = await makeUser('manager-a', studioA, ['production-manager'])
    adminB = await makeUser('admin-b', studioB, ['admin'])
    event = await payload.create({
      collection: 'events',
      data: {
        tenant: studioA.id,
        title: `${PREFIX}Gala night`,
        slug: `${PREFIX}gala`,
        startsAt: new Date(NOW + 30 * 86_400_000).toISOString(),
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

  it("lets only the studio's admins and finance managers refund", async () => {
    const ticketType = await makeTicketType()
    const { registration } = await buyTicket(ticketType)
    for (const user of [managerA, adminB, null]) {
      expect(await refundTicket({ payload, user, registrationId: registration.id, stripe: fakeStripe })).toEqual({
        status: 'error',
        reason: 'forbidden',
      })
    }
    expect((await payload.findByID({ collection: 'registrations', id: registration.id, overrideAccess: true })).status).toBe(
      'confirmed',
    )

    const req = (await createLocalReq({}, payload)) as PayloadRequest
    req.user = null
    req.routeParams = { id: String(registration.id) }
    expect((await refundTicketEndpoint(req)).status).toBe(401)
  })

  it('refunds the full amount once, cancels the ticket at once, and is confirmed by the webhook', async () => {
    const ticketType = await makeTicketType()
    const bought = await buyTicket(ticketType)
    expect(bought.payment).toMatchObject({ status: 'paid', stripePaymentIntentId: bought.paymentIntent })
    expect(await placesTaken(payload, ticketType.id)).toBe(2)

    expect(await refundTicket({ payload, user: adminA, registrationId: bought.registration.id, stripe: fakeStripe })).toEqual({
      status: 'requested',
    })
    expect(refunds[refunds.length - 1]).toEqual({
      paymentIntentId: bought.paymentIntent,
      amount: 5000,
      metadata: { paymentId: String(bought.payment.id), registrationId: String(bought.registration.id), kind: 'ticket-refund' },
      idempotencyKey: `ticket-refund-${bought.payment.id}`,
    })
    let now = await reload(bought.payment, bought.registration)
    expect(now.payment).toMatchObject({ status: 'refund-pending', stripeRefundId: expect.stringMatching(/^re_/) })
    expect(now.registration.status).toBe('cancelled')
    expect(await placesTaken(payload, ticketType.id)).toBe(0)
    // Asking again does not ask Stripe again.
    const asked = refunds.length
    expect(await refundTicket({ payload, user: adminA, registrationId: bought.registration.id, stripe: fakeStripe })).toMatchObject({
      reason: 'notPaid',
    })
    expect(refunds).toHaveLength(asked)

    const refunded = { id: `ch_${PREFIX}${++counter}`, object: 'charge', payment_intent: bought.paymentIntent, amount_refunded: 5000, refunded: true }
    const eventId = `evt_${PREFIX}refund_${++counter}`
    expect(await (await send('charge.refunded', refunded, eventId)).json()).toMatchObject({ handled: true })
    now = await reload(bought.payment, bought.registration)
    expect(now.payment).toMatchObject({ status: 'refunded', refundedAmount: 5000 })
    // The same event again changes nothing; a repeated payment event does not undo the refund.
    expect(await (await send('charge.refunded', refunded, eventId)).json()).toMatchObject({ handled: false })
    await send('checkout.session.completed', {
      id: bought.sessionId,
      object: 'checkout.session',
      payment_status: 'paid',
      amount_total: 5000,
      currency: 'eur',
      metadata: {},
    })
    expect((await payload.findByID({ collection: 'payments', id: bought.payment.id, overrideAccess: true })).status).toBe('refunded')
  })

  it('changes nothing when Stripe refuses the refund', async () => {
    const ticketType = await makeTicketType()
    const bought = await buyTicket(ticketType)
    const failing: TicketRefunds = {
      ...fakeStripe,
      createRefund: async () => {
        throw new Error('Stripe is down')
      },
    }
    expect(await refundTicket({ payload, user: adminA, registrationId: bought.registration.id, stripe: failing })).toMatchObject({
      reason: 'failed',
    })
    const now = await reload(bought.payment, bought.registration)
    expect(now.payment.status).toBe('paid')
    expect(now.registration.status).toBe('confirmed')
  })

  it('finds the Stripe payment of an older ticket before refunding it', async () => {
    const ticketType = await makeTicketType()
    const bought = await buyTicket(ticketType, { storeIntent: false })
    expect(bought.payment.stripePaymentIntentId ?? null).toBeNull()
    await refundTicket({ payload, user: adminA, registrationId: bought.registration.id, stripe: fakeStripe })
    expect(lookups[lookups.length - 1]).toBe(bought.sessionId)
    const payment = await payload.findByID({ collection: 'payments', id: bought.payment.id, overrideAccess: true })
    expect(payment.stripePaymentIntentId).toMatch(/looked_up/)
    expect(refunds[refunds.length - 1]!.paymentIntentId).toBe(payment.stripePaymentIntentId)
  })

  it('records a refund made in the Stripe dashboard and cancels the ticket', async () => {
    const ticketType = await makeTicketType()
    const bought = await buyTicket(ticketType)
    // A partial refund is recorded but keeps the ticket.
    await send('charge.refunded', { id: `ch_${PREFIX}${++counter}`, object: 'charge', payment_intent: bought.paymentIntent, amount_refunded: 1000, refunded: false })
    let now = await reload(bought.payment, bought.registration)
    expect(now.payment).toMatchObject({ status: 'paid', refundedAmount: 1000 })
    expect(now.registration.status).toBe('confirmed')

    await send('charge.refunded', { id: `ch_${PREFIX}${++counter}`, object: 'charge', payment_intent: bought.paymentIntent, amount_refunded: 5000, refunded: true })
    now = await reload(bought.payment, bought.registration)
    expect(now.payment).toMatchObject({ status: 'refunded', refundedAmount: 5000 })
    expect(now.registration.status).toBe('cancelled')

    // A charge that is not one of ours is acknowledged and ignored.
    expect(
      await (await send('charge.refunded', { id: 'ch_other', object: 'charge', payment_intent: 'pi_unknown', amount_refunded: 100, refunded: true })).json(),
    ).toMatchObject({ handled: false })
  })
})
