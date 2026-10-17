import { getPayload, type Payload } from 'payload'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import config from '@/payload.config'
import type { Tenant } from '@/payload-types'
import { getStripe } from '@/lib/stripe'
import { handleStripeWebhook } from '@/lib/stripeWebhook'

import { ensureTenant } from '../helpers/seedTenant'

const PREFIX = 'int-stripe-'
const SECRET = 'whsec_int_test_secret'
const URL = 'http://localhost/api/stripe/webhook'

let payload: Payload
let studio: Tenant
let counter = 0
const originalSecrets = {
  key: process.env.STRIPE_SECRET_KEY,
  webhook: process.env.STRIPE_WEBHOOK_SECRET,
}

type SessionOverrides = Partial<{
  payment_status: string
  amount_total: number
  currency: string
  metadata: Record<string, string>
}>

/** A Checkout session as Stripe reports it once the client has paid. */
const session = (sessionId: string, overrides: SessionOverrides = {}) => ({
  id: sessionId,
  object: 'checkout.session',
  payment_status: 'paid',
  amount_total: 6000,
  currency: 'eur',
  metadata: {},
  ...overrides,
})

const event = (id: string, type: string, object: unknown) => ({
  id,
  object: 'event',
  type,
  data: { object },
})

/** Sends a webhook the way Stripe does: JSON body, signed with the webhook secret. */
const send = (body: unknown, { sign = true }: { sign?: boolean } = {}) => {
  const payloadText = JSON.stringify(body)
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (sign) {
    headers['stripe-signature'] = getStripe().webhooks.generateTestHeaderString({
      payload: payloadText,
      secret: SECRET,
    })
  }
  return handleStripeWebhook(new Request(URL, { method: 'POST', headers, body: payloadText }))
}

/** A sent quote for €200.00 with a 30% deposit (€60.00), plus its pending payment. */
const sentQuoteWithPayment = async (sessionId: string) => {
  const quote = await payload.create({
    collection: 'quotes',
    data: {
      tenant: studio.id,
      title: `${PREFIX}quote ${++counter}`,
      clientName: 'Joana Costa',
      clientEmail: `${PREFIX}joana@example.com`,
      currency: 'eur',
      lineItems: [{ description: 'Full day', quantity: 1, unitAmount: 20000 }],
      depositPercent: 30,
      status: 'sent',
    },
    overrideAccess: true,
  })
  await payload.create({
    collection: 'payments',
    data: {
      tenant: studio.id,
      quote: quote.id,
      kind: 'deposit',
      amount: quote.depositAmount!,
      currency: 'eur',
      status: 'pending',
      stripeSessionId: sessionId,
    },
    overrideAccess: true,
  })
  return quote
}

const quoteNow = (id: number) => payload.findByID({ collection: 'quotes', id, depth: 0, overrideAccess: true })
const paymentFor = async (sessionId: string) =>
  (
    await payload.find({
      collection: 'payments',
      where: { stripeSessionId: { equals: sessionId } },
      depth: 0,
      overrideAccess: true,
    })
  ).docs[0]

describe('Stripe webhook', () => {
  beforeAll(async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_int_placeholder'
    process.env.STRIPE_WEBHOOK_SECRET = SECRET
    payload = await getPayload({ config: await config })
    studio = await ensureTenant(payload, { name: 'Int Studio Stripe', slug: 'int-studio-stripe' })
    await payload.delete({ collection: 'payments', where: { stripeSessionId: { like: PREFIX } } })
    await payload.delete({ collection: 'quotes', where: { title: { like: PREFIX } } })
  })

  beforeEach(async () => {
    await payload.delete({ collection: 'payments', where: { stripeSessionId: { like: PREFIX } } })
    await payload.delete({ collection: 'quotes', where: { title: { like: PREFIX } } })
  })

  afterAll(async () => {
    await payload.delete({ collection: 'payments', where: { stripeSessionId: { like: PREFIX } } })
    await payload.delete({ collection: 'quotes', where: { title: { like: PREFIX } } })
    process.env.STRIPE_SECRET_KEY = originalSecrets.key
    process.env.STRIPE_WEBHOOK_SECRET = originalSecrets.webhook
  })

  it('marks the payment and the quote paid when a signed, paid session arrives', async () => {
    const sessionId = `${PREFIX}paid-1`
    const quote = await sentQuoteWithPayment(sessionId)
    const response = await send(event('evt_int_paid_1', 'checkout.session.completed', session(sessionId)))

    expect(response.status).toBe(200)
    expect(await quoteNow(quote.id)).toMatchObject({ status: 'deposit-paid' })
    expect(await paymentFor(sessionId)).toMatchObject({ status: 'paid', stripeEventId: 'evt_int_paid_1' })
  })

  it('ignores a repeated delivery of the same event', async () => {
    const sessionId = `${PREFIX}replay`
    const quote = await sentQuoteWithPayment(sessionId)
    const body = event('evt_int_replay', 'checkout.session.completed', session(sessionId))
    expect((await send(body)).status).toBe(200)
    const again = await send(body)
    expect(again.status).toBe(200)
    expect(await again.json()).toMatchObject({ duplicate: true })
    expect(await quoteNow(quote.id)).toMatchObject({ status: 'deposit-paid' })
    const payments = await payload.find({
      collection: 'payments',
      where: { stripeSessionId: { equals: sessionId } },
      overrideAccess: true,
    })
    expect(payments.totalDocs).toBe(1)
  })

  it('refuses unsigned or wrongly signed calls, and changes nothing', async () => {
    const sessionId = `${PREFIX}unsigned`
    const quote = await sentQuoteWithPayment(sessionId)
    const body = event('evt_int_unsigned', 'checkout.session.completed', session(sessionId))

    expect((await send(body, { sign: false })).status).toBe(400)

    const forged = new Request(URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'stripe-signature': getStripe().webhooks.generateTestHeaderString({
          payload: JSON.stringify(body),
          secret: 'whsec_someone_else',
        }),
      },
      body: JSON.stringify(body),
    })
    expect((await handleStripeWebhook(forged)).status).toBe(400)

    expect(await quoteNow(quote.id)).toMatchObject({ status: 'sent' })
    expect(await paymentFor(sessionId)).toMatchObject({ status: 'pending' })
  })

  it('does not mark a payment paid when the amount or currency differs from the quote', async () => {
    const sessionId = `${PREFIX}short`
    const quote = await sentQuoteWithPayment(sessionId)
    const response = await send(
      event('evt_int_short', 'checkout.session.completed', session(sessionId, { amount_total: 100 })),
    )
    expect(response.status).toBe(200)
    expect(await quoteNow(quote.id)).toMatchObject({ status: 'sent' })
    expect(await paymentFor(sessionId)).toMatchObject({ status: 'failed' })

    const otherCurrency = `${PREFIX}usd`
    const quote2 = await sentQuoteWithPayment(otherCurrency)
    await send(event('evt_int_usd', 'checkout.session.completed', session(otherCurrency, { currency: 'usd' })))
    expect(await quoteNow(quote2.id)).toMatchObject({ status: 'sent' })
    expect(await paymentFor(otherCurrency)).toMatchObject({ status: 'failed' })
  })

  it('waits for sessions that are not paid yet', async () => {
    const sessionId = `${PREFIX}unpaid`
    const quote = await sentQuoteWithPayment(sessionId)
    const response = await send(
      event('evt_int_unpaid', 'checkout.session.completed', session(sessionId, { payment_status: 'unpaid' })),
    )
    expect(await response.json()).toMatchObject({ handled: false })
    expect(await quoteNow(quote.id)).toMatchObject({ status: 'sent' })
    expect(await paymentFor(sessionId)).toMatchObject({ status: 'pending' })
  })

  it('records a paid session whose payment record was never saved, from the quote in its metadata', async () => {
    const quote = await payload.create({
      collection: 'quotes',
      data: {
        tenant: studio.id,
        title: `${PREFIX}recovered`,
        clientName: 'Rui Matos',
        clientEmail: `${PREFIX}rui@example.com`,
        currency: 'eur',
        lineItems: [{ description: 'Film', quantity: 1, unitAmount: 20000 }],
        depositPercent: 30,
        status: 'sent',
      },
      overrideAccess: true,
    })
    const sessionId = `${PREFIX}recovered`
    await send(
      event(
        'evt_int_recovered',
        'checkout.session.completed',
        session(sessionId, { metadata: { quoteId: String(quote.id), tenantId: String(studio.id) } }),
      ),
    )
    expect(await quoteNow(quote.id)).toMatchObject({ status: 'deposit-paid' })
    expect(await paymentFor(sessionId)).toMatchObject({ status: 'paid' })
  })

  it('does not take a quote from another studio because of metadata', async () => {
    const other = await ensureTenant(payload, { name: 'Int Studio Other', slug: 'int-studio-other' })
    const quote = await sentQuoteWithPayment(`${PREFIX}cross`)
    const sessionId = `${PREFIX}cross-2`
    await send(
      event(
        'evt_int_cross',
        'checkout.session.completed',
        session(sessionId, { metadata: { quoteId: String(quote.id), tenantId: String(other.id) } }),
      ),
    )
    expect(await quoteNow(quote.id)).toMatchObject({ status: 'sent' })
    expect(await paymentFor(sessionId)).toBeUndefined()
  })

  it('acknowledges other event types without recording anything', async () => {
    const response = await send(event('evt_int_other', 'payment_intent.created', { id: `${PREFIX}pi` }))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ handled: false })
  })

  it('is unavailable until both Stripe secrets are set', async () => {
    const body = event('evt_int_off', 'checkout.session.completed', session(`${PREFIX}off`))
    process.env.STRIPE_WEBHOOK_SECRET = ''
    try {
      expect((await send(body)).status).toBe(503)
    } finally {
      process.env.STRIPE_WEBHOOK_SECRET = SECRET
    }
  })

  describe('balance after the deposit', () => {
    /** A quote whose deposit has been paid through the webhook, plus a pending balance payment. */
    const depositPaidWithBalance = async (depositSession: string, balanceSession: string) => {
      const quote = await sentQuoteWithPayment(depositSession)
      await send(event(`evt_${depositSession}`, 'checkout.session.completed', session(depositSession)))
      await payload.create({
        collection: 'payments',
        data: {
          tenant: studio.id,
          quote: quote.id,
          kind: 'balance',
          amount: 14000,
          currency: 'eur',
          status: 'pending',
          stripeSessionId: balanceSession,
        },
        overrideAccess: true,
      })
      return quote
    }

    it('marks the quote paid in full when the balance arrives', async () => {
      const quote = await depositPaidWithBalance(`${PREFIX}deposit-ok`, `${PREFIX}balance-ok`)
      expect((await quoteNow(quote.id)).status).toBe('deposit-paid')

      const response = await send(
        event('evt_int_balance_ok', 'checkout.session.completed', session(`${PREFIX}balance-ok`, { amount_total: 14000 })),
      )
      expect(response.status).toBe(200)
      expect((await quoteNow(quote.id)).status).toBe('paid-in-full')
      expect((await paymentFor(`${PREFIX}balance-ok`))?.status).toBe('paid')
    })

    it('does not mark the quote paid in full when the balance amount is wrong', async () => {
      const quote = await depositPaidWithBalance(`${PREFIX}deposit-short`, `${PREFIX}balance-short`)
      const response = await send(
        event('evt_int_balance_short', 'checkout.session.completed', session(`${PREFIX}balance-short`, { amount_total: 13000 })),
      )
      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({ mismatch: true })
      expect((await quoteNow(quote.id)).status).toBe('deposit-paid')
      expect((await paymentFor(`${PREFIX}balance-short`))?.status).toBe('failed')
    })

    it('keeps a paid-in-full quote paid when the deposit event is replayed', async () => {
      const quote = await depositPaidWithBalance(`${PREFIX}deposit-replay`, `${PREFIX}balance-replay`)
      await send(event('evt_int_balance_replay', 'checkout.session.completed', session(`${PREFIX}balance-replay`, { amount_total: 14000 })))
      expect((await quoteNow(quote.id)).status).toBe('paid-in-full')

      const replay = await send(
        event(`evt_${PREFIX}deposit-replay`, 'checkout.session.completed', session(`${PREFIX}deposit-replay`)),
      )
      expect(await replay.json()).toMatchObject({ duplicate: true })
      expect((await quoteNow(quote.id)).status).toBe('paid-in-full')
    })

    it('does not mark a quote paid in full from a balance payment before its deposit is recorded', async () => {
      const quote = await sentQuoteWithPayment(`${PREFIX}deposit-early`)
      await payload.create({
        collection: 'payments',
        data: {
          tenant: studio.id,
          quote: quote.id,
          kind: 'balance',
          amount: 14000,
          currency: 'eur',
          status: 'pending',
          stripeSessionId: `${PREFIX}balance-early`,
        },
        overrideAccess: true,
      })
      await send(event('evt_int_balance_early', 'checkout.session.completed', session(`${PREFIX}balance-early`, { amount_total: 14000 })))
      expect((await quoteNow(quote.id)).status).toBe('sent')
      expect((await paymentFor(`${PREFIX}balance-early`))?.status).toBe('paid')
    })

    it('does not let staff or the API mark a quote paid in full', async () => {
      const quote = await depositPaidWithBalance(`${PREFIX}deposit-direct`, `${PREFIX}balance-direct`)
      await expect(
        payload.update({
          collection: 'quotes',
          id: quote.id,
          data: { status: 'paid-in-full' },
          overrideAccess: true,
        }),
      ).rejects.toThrow(/balance payment/)
      expect((await quoteNow(quote.id)).status).toBe('deposit-paid')
    })
  })
})
