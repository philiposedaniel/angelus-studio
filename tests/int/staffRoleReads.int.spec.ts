import { getPayload, type Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import config from '@/payload.config'
import type { Tenant, User } from '@/payload-types'

import { ensureTenant } from '../helpers/seedTenant'

/**
 * Each studio role reads the admin collections through the API as that user (no overrideAccess), so the
 * access rules decide what they see. Staff who are not on a collection's list must not see its records,
 * and a studio's records must never reach another studio's staff.
 */

const PREFIX = 'int-staff-read-'
const password = 'int-Password-1'

type Outcome = 'visible' | 'hidden'

let payload: Payload
let studioA: Tenant
let studioB: Tenant
const users: Record<string, User> = {}

const roleSets: Record<string, string[]> = {
  admin: ['admin'],
  'production-manager': ['production-manager'],
  'finance-manager': ['finance-manager'],
  photographer: ['photographer'],
  videographer: ['videographer'],
  editor: ['editor'],
  'event-organizer': ['event-organizer'],
  client: ['client'],
}

const cleanup = async () => {
  await payload.delete({ collection: 'payments', where: { stripeSessionId: { like: PREFIX } }, overrideAccess: true })
  await payload.delete({ collection: 'quotes', where: { title: { like: PREFIX } }, overrideAccess: true })
  await payload.delete({ collection: 'inquiries', where: { name: { like: PREFIX } }, overrideAccess: true })
  await payload.delete({ collection: 'users', where: { email: { like: PREFIX } }, overrideAccess: true })
}

const makeUser = async (role: string, tenant: Tenant) =>
  payload.create({
    collection: 'users',
    data: {
      email: `${PREFIX}${role}-${tenant.slug}@angelus.test`,
      password,
      roles: ['user'],
      tenants: [{ tenant: tenant.id, roles: roleSets[role] as never }],
    },
    overrideAccess: true,
  })

/**
 * Whether the user sees any record of the collection in the studio. A role with no access at all is
 * refused by the API, which counts as hidden.
 */
const outcome = async (collection: 'quotes' | 'payments' | 'inquiries', user: User, tenant: Tenant): Promise<Outcome> => {
  try {
    const { docs } = await payload.find({
      collection,
      user,
      overrideAccess: false,
      where: {
        and: [
          { tenant: { equals: tenant.id } },
          collection === 'payments'
            ? { stripeSessionId: { like: PREFIX } }
            : collection === 'quotes'
              ? { title: { like: PREFIX } }
              : { name: { like: PREFIX } },
        ],
      },
      pagination: false,
    })
    return docs.length > 0 ? 'visible' : 'hidden'
  } catch {
    return 'hidden'
  }
}

const seedRecords = async () => {
  const quote = await payload.create({
    collection: 'quotes',
    data: {
      tenant: studioA.id,
      title: `${PREFIX}quote`,
      clientName: 'Maria Silva',
      clientEmail: 'maria@example.test',
      currency: 'eur',
      lineItems: [{ description: 'Wedding photography', quantity: 1, unitAmount: 100000 }],
      depositPercent: 30,
      status: 'sent',
    },
    overrideAccess: true,
  })
  await payload.create({
    collection: 'payments',
    data: {
      tenant: studioA.id,
      quote: quote.id,
      kind: 'deposit',
      amount: 30000,
      currency: 'eur',
      status: 'paid',
      paidAt: '2026-10-17T10:00:00.000Z',
      stripeSessionId: `${PREFIX}deposit`,
    },
    overrideAccess: true,
  })
  await payload.create({
    collection: 'inquiries',
    data: {
      tenant: studioA.id,
      name: `${PREFIX}inquiry`,
      email: 'lead@example.test',
      eventType: 'wedding',
      message: 'We would like a photographer for our day.',
    } as never,
    overrideAccess: true,
  })
}

// Who may read each collection, from the collection's own access rules.
const allowed: Record<'quotes' | 'payments' | 'inquiries', string[]> = {
  quotes: ['admin', 'production-manager', 'finance-manager'],
  payments: ['admin', 'finance-manager'],
  inquiries: ['admin', 'production-manager', 'finance-manager'],
}

describe('staff role reads of the admin collections', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    studioA = await ensureTenant(payload, { name: 'Int Staff Read A', slug: 'int-staff-read-a' })
    studioB = await ensureTenant(payload, { name: 'Int Staff Read B', slug: 'int-staff-read-b' })
    await cleanup()
    for (const role of Object.keys(roleSets)) {
      users[`${role}-A`] = await makeUser(role, studioA)
    }
    users['admin-B'] = await makeUser('admin', studioB)
    await seedRecords()
  })

  afterAll(cleanup)

  for (const collection of ['quotes', 'payments', 'inquiries'] as const) {
    it(`shows ${collection} only to the studio roles that may read them`, async () => {
      for (const role of Object.keys(roleSets)) {
        const expected: Outcome = allowed[collection].includes(role) ? 'visible' : 'hidden'
        expect({ role, outcome: await outcome(collection, users[`${role}-A`]!, studioA) }).toEqual({
          role,
          outcome: expected,
        })
      }
    })
  }

  it('shows a studio’s quotes, payments and inquiries to no one of another studio', async () => {
    for (const collection of ['quotes', 'payments', 'inquiries'] as const) {
      expect(await outcome(collection, users['admin-B']!, studioA)).toBe('hidden')
    }
  })
})
