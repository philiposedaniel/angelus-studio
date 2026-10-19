import { getPayload, type Payload } from 'payload'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import config from '@/payload.config'
import type { Tenant } from '@/payload-types'
import { getStripe } from '@/lib/stripe'
import { handleStripeWebhook } from '@/lib/stripeWebhook'

import { ensureTenant } from '../helpers/seedTenant'

const PREFIX = 'int-schedule-'
const SECRET = 'whsec_int_schedule_secret'
const URL = 'http://localhost/api/stripe/webhook'

let payload: Payload
let studio: Tenant
let counter = 0
const originalSecrets = {
  key: process.env.STRIPE_SECRET_KEY,
  webhook: process.env.STRIPE_WEBHOOK_SECRET,
}

/** The balance after a €60.00 deposit on a €200.00 quote is €140.00, split into two €70.00 installments. */
const BALANCE = 14000
const TWO_INSTALLMENTS = [
  { dueDate: '2026-11-15T00:00:00.000Z', amount: 7000 },
  { dueDate: '2026-12-15T00:00:00.000Z', amount: 7000 },
]

const session = (sessionId: string, amountTotal: number) => ({
  id: sessionId,
  object: 'checkout.session',
  payment_status: 'paid',
  amount_total: amountTotal,
  currency: 'eur',
  metadata: {},
})

const event = (id: string, type: string, object: unknown) => ({ id, object: 'event', type, data: { object } })

/** Sends a webhook the way Stripe does: JSON body, signed with the webhook secret. */
const send = (body: unknown) => {
  const payloadText = JSON.stringify(body)
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'stripe-signature': getStripe().webhooks.generateTestHeaderString({ payload: payloadText, secret: SECRET }),
  }
  return handleStripeWebhook(new Request(URL, { method: 'POST', headers, body: payloadText }))
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

type ScheduleInput = { dueDate: string; amount: number }[] | undefined

const makeQuote = (schedule: ScheduleInput, status: 'sent' | 'deposit-paid' = 'sent') =>
  payload.create({
    collection: 'quotes',
    data: {
      tenant: studio.id,
      title: `${PREFIX}quote ${++counter}`,
      clientName: 'Joana Costa',
      clientEmail: `${PREFIX}joana@example.com`,
      currency: 'eur',
      lineItems: [{ description: 'Full day', quantity: 1, unitAmount: 20000 }],
      depositPercent: 30,
      status,
      ...(schedule ? { paymentSchedule: schedule } : {}),
    },
    overrideAccess: true,
  })

/** A quote whose deposit has been paid through the webhook, with the given schedule. */
const depositPaidQuote = async (schedule: ScheduleInput) => {
  const quote = await makeQuote(schedule)
  const depositSession = `${PREFIX}deposit ${counter}`
  await payload.create({
    collection: 'payments',
    data: {
      tenant: studio.id,
      quote: quote.id,
      kind: 'deposit',
      amount: 6000,
      currency: 'eur',
      status: 'pending',
      stripeSessionId: depositSession,
    },
    overrideAccess: true,
  })
  await send(event(`evt_${depositSession}`, 'checkout.session.completed', session(depositSession, 6000)))
  return quote
}

const pendingInstallment = (quoteId: number, number: number, sessionId: string, amount: number) =>
  payload.create({
    collection: 'payments',
    data: {
      tenant: studio.id,
      quote: quoteId,
      kind: 'installment',
      installmentNumber: number,
      amount,
      currency: 'eur',
      status: 'pending',
      stripeSessionId: sessionId,
    },
    overrideAccess: true,
  })

describe('payment schedule for the balance', () => {
  beforeAll(async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_int_placeholder'
    process.env.STRIPE_WEBHOOK_SECRET = SECRET
    payload = await getPayload({ config: await config })
    studio = await ensureTenant(payload, { name: 'Int Schedule Studio', slug: 'int-schedule-studio' })
  })

  const clean = async () => {
    await payload.delete({ collection: 'payments', where: { stripeSessionId: { like: PREFIX } }, overrideAccess: true })
    await payload.delete({ collection: 'quotes', where: { title: { like: PREFIX } }, overrideAccess: true })
  }

  beforeEach(clean)
  afterAll(async () => {
    await clean()
    process.env.STRIPE_SECRET_KEY = originalSecrets.key
    process.env.STRIPE_WEBHOOK_SECRET = originalSecrets.webhook
  })

  it('saves a schedule whose installments add up to the balance', async () => {
    const quote = await makeQuote(TWO_INSTALLMENTS)
    expect(quote.paymentSchedule).toHaveLength(2)
    expect(quote.paymentSchedule?.map((row) => row.amount)).toEqual([7000, 7000])
  })

  it('refuses a schedule that does not add up to the balance exactly', async () => {
    await expect(
      makeQuote([
        { dueDate: '2026-11-15T00:00:00.000Z', amount: 7000 },
        { dueDate: '2026-12-15T00:00:00.000Z', amount: 6000 },
      ]),
    ).rejects.toThrow(/add up to the balance/)
  })

  it('refuses installments that are not in due-date order', async () => {
    await expect(
      makeQuote([
        { dueDate: '2026-12-15T00:00:00.000Z', amount: 7000 },
        { dueDate: '2026-11-15T00:00:00.000Z', amount: 7000 },
      ]),
    ).rejects.toThrow(/due-date order/)
  })

  it('refuses more installments than a quote can carry', async () => {
    // Thirteen rows that do add up to the balance are still refused: the limit is on the number of rows.
    const many = Array.from({ length: 13 }, (_, index) => ({
      dueDate: `2026-11-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`,
      amount: index === 0 ? 2000 : 1000,
    }))
    await expect(makeQuote(many)).rejects.toThrow(/at most 12/)
  })

  it('locks the schedule once the deposit is paid', async () => {
    const quote = await depositPaidQuote(TWO_INSTALLMENTS)
    await expect(
      payload.update({
        collection: 'quotes',
        id: quote.id,
        data: { paymentSchedule: [{ dueDate: '2026-11-15T00:00:00.000Z', amount: 14000 }] },
        overrideAccess: true,
      }),
    ).rejects.toThrow(/cannot change/)
  })

  it('keeps the quote deposit-paid after the first installment and marks it paid in full after the last', async () => {
    const quote = await depositPaidQuote(TWO_INSTALLMENTS)
    await pendingInstallment(quote.id, 1, `${PREFIX}inst-1`, 7000)
    await pendingInstallment(quote.id, 2, `${PREFIX}inst-2`, 7000)

    await send(event('evt_int_inst_1', 'checkout.session.completed', session(`${PREFIX}inst-1`, 7000)))
    expect((await quoteNow(quote.id)).status).toBe('deposit-paid')
    expect((await paymentFor(`${PREFIX}inst-1`))?.status).toBe('paid')

    await send(event('evt_int_inst_2', 'checkout.session.completed', session(`${PREFIX}inst-2`, 7000)))
    expect((await quoteNow(quote.id)).status).toBe('paid-in-full')
    expect((await paymentFor(`${PREFIX}inst-2`))?.status).toBe('paid')
  })

  it('does not count a repeated delivery of one installment as the next one', async () => {
    const quote = await depositPaidQuote(TWO_INSTALLMENTS)
    await pendingInstallment(quote.id, 1, `${PREFIX}again-1`, 7000)
    await pendingInstallment(quote.id, 2, `${PREFIX}again-2`, 7000)

    await send(event('evt_int_again_1', 'checkout.session.completed', session(`${PREFIX}again-1`, 7000)))
    const replay = await send(event('evt_int_again_1', 'checkout.session.completed', session(`${PREFIX}again-1`, 7000)))
    expect(replay.status).toBe(200)
    expect((await quoteNow(quote.id)).status).toBe('deposit-paid')
  })

  it('does not record an installment whose amount differs from the schedule', async () => {
    const quote = await depositPaidQuote(TWO_INSTALLMENTS)
    await pendingInstallment(quote.id, 1, `${PREFIX}short-1`, 7000)
    await send(event('evt_int_short_1', 'checkout.session.completed', session(`${PREFIX}short-1`, 6500)))
    expect((await paymentFor(`${PREFIX}short-1`))?.status).toBe('failed')
    expect((await quoteNow(quote.id)).status).toBe('deposit-paid')
  })

  it('leaves the balance-by-one-payment path unchanged for a quote without a schedule', async () => {
    const quote = await depositPaidQuote(undefined)
    await payload.create({
      collection: 'payments',
      data: {
        tenant: studio.id,
        quote: quote.id,
        kind: 'balance',
        amount: BALANCE,
        currency: 'eur',
        status: 'pending',
        stripeSessionId: `${PREFIX}balance`,
      },
      overrideAccess: true,
    })
    await send(event('evt_int_balance', 'checkout.session.completed', session(`${PREFIX}balance`, BALANCE)))
    expect((await quoteNow(quote.id)).status).toBe('paid-in-full')
  })
})
