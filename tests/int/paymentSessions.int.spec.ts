import { getPayload, type Payload } from 'payload'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import config from '@/payload.config'
import type { Tenant } from '@/payload-types'
import { expireWaitingPayments } from '@/lib/paymentSessions'

import { ensureTenant } from '../helpers/seedTenant'

const PREFIX = 'int-sessions-'
let payload: Payload
let studio: Tenant
let counter = 0

const makeQuote = () =>
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
      status: 'sent',
      paymentSchedule: [
        { dueDate: '2026-11-15T00:00:00.000Z', amount: 7000 },
        { dueDate: '2026-12-15T00:00:00.000Z', amount: 7000 },
      ],
    },
    overrideAccess: true,
  })

const pay = (quoteId: number, data: { kind: 'installment' | 'balance'; installmentNumber?: number; sessionId: string; status?: 'pending' | 'paid' }) =>
  payload.create({
    collection: 'payments',
    data: {
      tenant: studio.id,
      quote: quoteId,
      kind: data.kind,
      ...(data.installmentNumber === undefined ? {} : { installmentNumber: data.installmentNumber }),
      amount: 7000,
      currency: 'eur',
      status: data.status ?? 'pending',
      stripeSessionId: data.sessionId,
    },
    overrideAccess: true,
  })

const statusOf = async (sessionId: string) =>
  (
    await payload.find({
      collection: 'payments',
      where: { stripeSessionId: { equals: sessionId } },
      depth: 0,
      overrideAccess: true,
    })
  ).docs[0]?.status

describe('payment pages for one installment or balance', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    studio = await ensureTenant(payload, { name: 'Int Sessions Studio', slug: 'int-sessions-studio' })
  })

  const clean = async () => {
    await payload.delete({ collection: 'payments', where: { stripeSessionId: { like: PREFIX } }, overrideAccess: true })
    await payload.delete({ collection: 'quotes', where: { title: { like: PREFIX } }, overrideAccess: true })
  }

  beforeEach(clean)
  afterAll(clean)

  it('expires the older waiting session for the same installment and leaves other installments alone', async () => {
    const quote = await makeQuote()
    await pay(quote.id, { kind: 'installment', installmentNumber: 1, sessionId: `${PREFIX}first-1` })
    await pay(quote.id, { kind: 'installment', installmentNumber: 2, sessionId: `${PREFIX}other-2` })
    const expired: string[] = []

    const count = await expireWaitingPayments({
      payload,
      expire: async (id) => {
        expired.push(id)
      },
      tenantId: studio.id,
      quoteId: quote.id,
      kind: 'installment',
      installmentNumber: 1,
    })

    expect(count).toBe(1)
    expect(expired).toEqual([`${PREFIX}first-1`])
    expect(await statusOf(`${PREFIX}first-1`)).toBe('expired')
    expect(await statusOf(`${PREFIX}other-2`)).toBe('pending')
  })

  it('leaves a paid payment alone', async () => {
    const quote = await makeQuote()
    await pay(quote.id, { kind: 'installment', installmentNumber: 1, sessionId: `${PREFIX}paid-1`, status: 'paid' })
    const expired: string[] = []

    const count = await expireWaitingPayments({
      payload,
      expire: async (id) => {
        expired.push(id)
      },
      tenantId: studio.id,
      quoteId: quote.id,
      kind: 'installment',
      installmentNumber: 1,
    })

    expect(count).toBe(0)
    expect(expired).toEqual([])
    expect(await statusOf(`${PREFIX}paid-1`)).toBe('paid')
  })

  it('keeps the session waiting, and opens nothing new, when Stripe refuses to expire it', async () => {
    const quote = await makeQuote()
    await pay(quote.id, { kind: 'balance', sessionId: `${PREFIX}balance-1` })

    await expect(
      expireWaitingPayments({
        payload,
        expire: async () => {
          throw new Error('This Checkout Session is complete.')
        },
        tenantId: studio.id,
        quoteId: quote.id,
        kind: 'balance',
        installmentNumber: null,
      }),
    ).rejects.toThrow(/complete/)
    expect(await statusOf(`${PREFIX}balance-1`)).toBe('pending')
  })

  it('does not expire another studio\'s payments for the same quote id', async () => {
    const quote = await makeQuote()
    await pay(quote.id, { kind: 'balance', sessionId: `${PREFIX}mine-balance` })
    const expired: string[] = []

    await expireWaitingPayments({
      payload,
      expire: async (id) => {
        expired.push(id)
      },
      tenantId: studio.id + 999,
      quoteId: quote.id,
      kind: 'balance',
      installmentNumber: null,
    })

    expect(expired).toEqual([])
    expect(await statusOf(`${PREFIX}mine-balance`)).toBe('pending')
  })
})
