import { getPayload, type Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { STRIPE_PAYMENT_CONTEXT } from '@/collections/Quotes'
import config from '@/payload.config'
import type { Tenant } from '@/payload-types'
import { loadInvoice } from '@/lib/invoices'

import { ensureTenant } from '../helpers/seedTenant'

const PREFIX = 'int-invoice-'

let payload: Payload
let studioA: Tenant
let studioB: Tenant

const cleanup = async () => {
  await payload.delete({ collection: 'payments', where: { stripeSessionId: { like: PREFIX } }, overrideAccess: true })
  await payload.delete({ collection: 'quotes', where: { title: { like: PREFIX } }, overrideAccess: true })
}

/** A sent quote, then moved to deposit-paid the way the verified webhook does it. */
const makePaidQuote = async (tenant: Tenant, title: string) => {
  const quote = await payload.create({
    collection: 'quotes',
    data: {
      tenant: tenant.id,
      title: `${PREFIX}${title}`,
      clientName: 'Maria Silva',
      clientEmail: 'maria@example.test',
      currency: 'eur',
      lineItems: [{ description: 'Wedding photography', quantity: 1, unitAmount: 100000 }],
      depositPercent: 30,
      status: 'sent',
    },
    overrideAccess: true,
  })
  return payload.update({
    collection: 'quotes',
    id: quote.id,
    data: { status: 'deposit-paid' },
    context: STRIPE_PAYMENT_CONTEXT,
    overrideAccess: true,
  })
}

const recordDeposit = (tenant: Tenant, quoteId: number, amount: number, label: string) =>
  payload.create({
    collection: 'payments',
    data: {
      tenant: tenant.id,
      quote: quoteId,
      kind: 'deposit',
      amount,
      currency: 'eur',
      status: 'paid',
      paidAt: '2026-10-17T10:00:00.000Z',
      stripeSessionId: `${PREFIX}${label}`,
    },
    overrideAccess: true,
  })

describe('quote invoices', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    studioA = await ensureTenant(payload, { name: 'Int Studio A', slug: 'int-studio-a' })
    studioB = await ensureTenant(payload, { name: 'Int Studio B', slug: 'int-studio-b' })
    await cleanup()
  })

  afterAll(async () => {
    await cleanup()
  })

  it('shows the quote with only its own confirmed payments', async () => {
    const quote = await makePaidQuote(studioA, 'own-payments')
    await recordDeposit(studioA, quote.id, 30000, 'own-deposit')

    const invoice = await loadInvoice(payload, studioA.id, quote.publicToken as string)
    expect(invoice).not.toBeNull()
    expect(invoice?.quote.id).toBe(quote.id)
    expect(invoice?.payments).toHaveLength(1)
    expect(invoice?.totals.depositPaid).toBe(30000)
    expect(invoice?.totals.amountDue).toBe(70000)
  })

  it('does not open a quote through another studio, even with its token', async () => {
    const quote = await makePaidQuote(studioA, 'other-studio')

    const invoice = await loadInvoice(payload, studioB.id, quote.publicToken as string)
    expect(invoice).toBeNull()
  })

  it('does not open a quote that has not been sent', async () => {
    const draft = await payload.create({
      collection: 'quotes',
      data: {
        tenant: studioA.id,
        title: `${PREFIX}draft`,
        clientName: 'Maria Silva',
        clientEmail: 'maria@example.test',
        currency: 'eur',
        lineItems: [{ description: 'Wedding photography', quantity: 1, unitAmount: 100000 }],
        depositPercent: 30,
        status: 'draft',
      },
      overrideAccess: true,
    })

    const invoice = await loadInvoice(payload, studioA.id, draft.publicToken as string)
    expect(invoice).toBeNull()
  })
})
