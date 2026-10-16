import { getPayload, type Payload } from 'payload'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import config from '@/payload.config'
import type { Tenant, User } from '@/payload-types'

import { ensureTenant } from '../helpers/seedTenant'

const PREFIX = 'int-quote-'
const password = 'int-Password-1'

let payload: Payload
let studioA: Tenant
let studioB: Tenant
let managerA: User
let managerB: User
let editorA: User
let financeA: User
let clientA: User

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

const quoteData = (tenant: Tenant, overrides: Record<string, unknown> = {}) => ({
  tenant: tenant.id,
  title: `${PREFIX}Wedding coverage`,
  clientName: 'Maria Silva',
  clientEmail: `${PREFIX}maria@example.com`,
  currency: 'eur' as const,
  lineItems: [
    { description: 'Photographer, full day', quantity: 2, unitAmount: 5000 },
    { description: 'Highlight film', quantity: 1, unitAmount: 2550 },
  ],
  depositPercent: 30,
  status: 'sent' as const,
  ...overrides,
})

const cleanup = async () => {
  await payload.delete({ collection: 'payments', where: { stripeSessionId: { like: PREFIX } } })
  await payload.delete({ collection: 'quotes', where: { title: { like: PREFIX } } })
  await payload.delete({ collection: 'users', where: { email: { like: PREFIX } } })
}

/** What a user can see of quotes, through the API as that user. */
const visibleTo = async (user: User) =>
  (
    await payload.find({
      collection: 'quotes',
      user,
      overrideAccess: false,
      where: { title: { like: PREFIX } },
      pagination: false,
    })
  ).docs

describe('quotes and payments', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    studioA = await ensureTenant(payload, { name: 'Int Studio A', slug: 'int-studio-a' })
    studioB = await ensureTenant(payload, { name: 'Int Studio B', slug: 'int-studio-b' })
    await cleanup()
    managerA = await makeUser('manager-a', studioA, ['production-manager'])
    managerB = await makeUser('manager-b', studioB, ['production-manager'])
    editorA = await makeUser('editor-a', studioA, ['editor'])
    financeA = await makeUser('finance-a', studioA, ['finance-manager'])
    clientA = await makeUser('client-a', studioA, ['client'])
  })

  beforeEach(async () => {
    await payload.delete({ collection: 'payments', where: { stripeSessionId: { like: PREFIX } } })
    await payload.delete({ collection: 'quotes', where: { title: { like: PREFIX } } })
  })

  afterAll(cleanup)

  it('works out totals on the server, whatever the request says', async () => {
    const quote = await payload.create({
      collection: 'quotes',
      data: quoteData(studioA, { totalAmount: 1, depositAmount: 1, publicToken: 'attacker-chosen' }) as never,
      overrideAccess: true,
    })
    expect(quote.totalAmount).toBe(12550)
    expect(quote.depositAmount).toBe(3765)
    expect(quote.publicToken).toMatch(/^[A-Za-z0-9_-]{32}$/)
    expect(quote.publicToken).not.toBe('attacker-chosen')
  })

  it('keeps the same link when a quote is changed, and recalculates the deposit', async () => {
    const quote = await payload.create({ collection: 'quotes', data: quoteData(studioA) as never, overrideAccess: true })
    const updated = await payload.update({
      collection: 'quotes',
      id: quote.id,
      data: { depositPercent: 50, publicToken: 'attacker-chosen' } as never,
      overrideAccess: true,
    })
    expect(updated.publicToken).toBe(quote.publicToken)
    expect(updated.depositAmount).toBe(6275)
  })

  it('lets only studio managers and finance staff of the studio create and read quotes', async () => {
    await payload.create({ collection: 'quotes', data: quoteData(studioA) as never, overrideAccess: true })
    expect(await visibleTo(managerA)).toHaveLength(1)
    expect(await visibleTo(financeA)).toHaveLength(1)
    expect(await visibleTo(managerB)).toHaveLength(0)
    // Editors and clients have no access to quotes at all, so the API refuses the read.
    await expect(visibleTo(editorA)).rejects.toThrow()
    await expect(visibleTo(clientA)).rejects.toThrow()

    await expect(
      payload.create({ collection: 'quotes', data: quoteData(studioA) as never, user: editorA, overrideAccess: false }),
    ).rejects.toThrow()
    await expect(
      payload.create({ collection: 'quotes', data: quoteData(studioA) as never, user: managerB, overrideAccess: false }),
    ).rejects.toThrow()
  })

  it('never shows a quote to another studio, even with its link', async () => {
    const quote = await payload.create({ collection: 'quotes', data: quoteData(studioA) as never, overrideAccess: true })
    const fromSiteB = await payload.find({
      collection: 'quotes',
      where: { and: [{ tenant: { equals: studioB.id } }, { publicToken: { equals: quote.publicToken } }] },
      overrideAccess: true,
    })
    expect(fromSiteB.docs).toHaveLength(0)
  })

  it('will not mark a quote paid, or undo payment, outside the Stripe webhook', async () => {
    const quote = await payload.create({ collection: 'quotes', data: quoteData(studioA) as never, overrideAccess: true })
    await expect(
      payload.update({ collection: 'quotes', id: quote.id, data: { status: 'deposit-paid' }, user: managerA, overrideAccess: false }),
    ).rejects.toThrow(/only when its deposit payment arrives/)

    const paid = await payload.update({
      collection: 'quotes',
      id: quote.id,
      data: { status: 'deposit-paid' },
      context: { stripePayment: true },
      overrideAccess: true,
    })
    expect(paid.status).toBe('deposit-paid')
    await expect(
      payload.update({ collection: 'quotes', id: quote.id, data: { status: 'cancelled' }, overrideAccess: true }),
    ).rejects.toThrow(/cannot change status/)
  })

  it('will not change the prices of a paid quote', async () => {
    const quote = await payload.create({ collection: 'quotes', data: quoteData(studioA) as never, overrideAccess: true })
    await payload.update({
      collection: 'quotes',
      id: quote.id,
      data: { status: 'deposit-paid' },
      context: { stripePayment: true },
      overrideAccess: true,
    })
    await expect(
      payload.update({
        collection: 'quotes',
        id: quote.id,
        data: { lineItems: [{ description: 'Cheaper', quantity: 1, unitAmount: 100 }] } as never,
        overrideAccess: true,
      }),
    ).rejects.toThrow(/prices of a paid quote/)
  })

  it('will not send a quote whose deposit is too small to pay online', async () => {
    await expect(
      payload.create({
        collection: 'quotes',
        data: quoteData(studioA, { lineItems: [{ description: 'Small', quantity: 1, unitAmount: 100 }] }) as never,
        overrideAccess: true,
      }),
    ).rejects.toThrow(/too small/)
  })

  it('keeps payment records to finance staff and admins, and never lets them be created by hand', async () => {
    const quote = await payload.create({ collection: 'quotes', data: quoteData(studioA) as never, overrideAccess: true })
    const payment = {
      tenant: studioA.id,
      quote: quote.id,
      amount: 3765,
      currency: 'eur' as const,
      status: 'paid' as const,
      stripeSessionId: `${PREFIX}manual`,
    }
    await expect(
      payload.create({ collection: 'payments', data: payment, user: financeA, overrideAccess: false }),
    ).rejects.toThrow()
    await expect(
      payload.create({ collection: 'payments', data: payment, user: managerA, overrideAccess: false }),
    ).rejects.toThrow()

    const created = await payload.create({ collection: 'payments', data: payment, overrideAccess: true })
    const seenByFinance = await payload.find({
      collection: 'payments',
      user: financeA,
      overrideAccess: false,
      where: { id: { equals: created.id } },
    })
    expect(seenByFinance.docs).toHaveLength(1)
    // Production managers cannot see money received at all.
    await expect(
      payload.find({
        collection: 'payments',
        user: managerA,
        overrideAccess: false,
        where: { id: { equals: created.id } },
      }),
    ).rejects.toThrow()
    await expect(
      payload.update({ collection: 'payments', id: created.id, data: { status: 'pending' }, user: financeA, overrideAccess: false }),
    ).rejects.toThrow()
  })

  it('holds one quote per link, with no two quotes sharing a token', async () => {
    const quote = await payload.create({ collection: 'quotes', data: quoteData(studioA) as never, overrideAccess: true })
    await expect(
      payload.create({
        collection: 'quotes',
        data: quoteData(studioA, { title: `${PREFIX}copy`, publicToken: quote.publicToken }) as never,
        overrideAccess: true,
      }),
    ).resolves.toBeDefined()
  })
})
