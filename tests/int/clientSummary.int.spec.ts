import { getPayload, type Payload } from 'payload'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import config from '@/payload.config'
import type { Tenant } from '@/payload-types'
import { clientSummary } from '@/lib/clientSummary'

import { ensureTenant } from '../helpers/seedTenant'

const PREFIX = 'int-client-summary-'
const EMAIL = `${PREFIX}client@angelus.test`
let payload: Payload
let studioA: Tenant
let studioB: Tenant
let client: { id: number; email: string }
let staffA: { id: number; email: string }
let staffB: { id: number; email: string }
let outsider: { id: number; email: string }

const quoteIn = (tenant: Tenant, title: string) =>
  payload.create({
    collection: 'quotes',
    data: {
      tenant: tenant.id,
      title: `${PREFIX}${title}`,
      clientName: 'Client',
      clientEmail: EMAIL,
      currency: 'eur',
      lineItems: [{ description: 'Day', quantity: 1, unitAmount: 20000 }],
      depositPercent: 30,
      status: 'sent',
    },
    overrideAccess: true,
  })

const staffUser = (email: string, tenant: Tenant) =>
  payload.create({
    collection: 'users',
    data: { email, password: 'int-Password-1', roles: ['user'], tenants: [{ tenant: tenant.id, roles: ['admin'] }] },
    overrideAccess: true,
  })

/** The request a signed-in user makes: the stored user, with their studio memberships. */
const requestAs = async (user: { id: number; email: string }) => {
  const stored = await payload.findByID({ collection: 'users', id: user.id, depth: 0, overrideAccess: true })
  return { user: { ...stored, collection: 'users' } } as never
}

describe('client summary for staff', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    await payload.delete({ collection: 'users', where: { email: { like: PREFIX } }, overrideAccess: true })
    studioA = await ensureTenant(payload, { name: 'Int Summary A', slug: 'int-summary-a' })
    studioB = await ensureTenant(payload, { name: 'Int Summary B', slug: 'int-summary-b' })
    const clientUser = await payload.create({
      collection: 'users',
      data: { email: EMAIL, password: 'int-Password-1', roles: ['user'], tenants: [{ tenant: studioA.id, roles: ['client'] }] },
      overrideAccess: true,
    })
    client = { id: clientUser.id, email: EMAIL }
    staffA = await staffUser(`${PREFIX}staff-a@angelus.test`, studioA)
    staffB = await staffUser(`${PREFIX}staff-b@angelus.test`, studioB)
    outsider = await payload.create({
      collection: 'users',
      data: { email: `${PREFIX}nobody@angelus.test`, password: 'int-Password-1', roles: ['user'] },
      overrideAccess: true,
    })
  })

  const clean = async () => {
    await payload.delete({ collection: 'projects', where: { title: { like: PREFIX } }, overrideAccess: true })
    await payload.delete({ collection: 'quotes', where: { title: { like: PREFIX } }, overrideAccess: true })
  }

  beforeEach(clean)
  afterAll(async () => {
    await clean()
    await payload.delete({ collection: 'users', where: { email: { like: PREFIX } }, overrideAccess: true })
  })

  it('lists a client\'s quotes and productions to staff of the studio that holds them', async () => {
    await quoteIn(studioA, 'quote a')
    await payload.create({
      collection: 'projects',
      data: {
        tenant: studioA.id,
        title: `${PREFIX}shoot a`,
        clientName: 'Client',
        clientEmail: EMAIL,
        clientUser: client.id,
        status: 'planning',
      },
      overrideAccess: true,
    })

    const summary = await clientSummary(payload, await requestAs(staffA), client)
    expect(summary.quotes.map((quote) => quote.title)).toEqual([`${PREFIX}quote a`])
    expect(summary.productions.map((project) => project.title)).toEqual([`${PREFIX}shoot a`])
  })

  it('shows staff of another studio none of this studio\'s quotes or productions', async () => {
    await quoteIn(studioA, 'quote a')
    await payload.create({
      collection: 'projects',
      data: { tenant: studioA.id, title: `${PREFIX}shoot a`, clientName: 'Client', clientEmail: EMAIL, clientUser: client.id, status: 'planning' },
      overrideAccess: true,
    })

    const summary = await clientSummary(payload, await requestAs(staffB), client)
    expect(summary.quotes).toEqual([])
    expect(summary.productions).toEqual([])
  })

  it('shows a user with no studio role nothing', async () => {
    await quoteIn(studioA, 'quote a')
    const summary = await clientSummary(payload, await requestAs(outsider), client)
    expect(summary.quotes).toEqual([])
  })

  it('shows a studio\'s own quote to its staff even when the client is a member of a different studio', async () => {
    await quoteIn(studioB, 'quote b')
    const summary = await clientSummary(payload, await requestAs(staffB), client)
    expect(summary.quotes.map((quote) => quote.title)).toEqual([`${PREFIX}quote b`])
  })
})
