import { getPayload, type Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { findPromoCode } from '@/lib/promoCodes'
import { isGuestListStaff, organizedEventIds } from '@/lib/organizers'
import config from '@/payload.config'
import type { Event, Tenant, User } from '@/payload-types'

import { ensureTenant } from '../helpers/seedTenant'

// Lookups that decide what a person may touch: which events they organize, whether they run a
// guest list, and which promo code applies to which event. Each must stay inside one studio.
const PREFIX = 'int-scope-'
const PROMO = 'INT-SCOPE-10'
const password = 'int-Password-1'

let payload: Payload
let studioA: Tenant
let studioB: Tenant
let eventA: Event
let eventB: Event
let organizerA: User
let adminA: User

const makeUser = async (name: string, tenant: Tenant, roles: string[]) => {
  const created = await payload.create({
    collection: 'users',
    data: {
      email: `${PREFIX}${name}@angelus.test`,
      password,
      roles: ['user'],
      tenants: [{ tenant: tenant.id, roles: roles as never }],
    },
    overrideAccess: true,
  })
  return payload.findByID({ collection: 'users', id: created.id, depth: 0, overrideAccess: true })
}

const cleanup = async () => {
  await payload.delete({ collection: 'promo-codes', where: { code: { equals: PROMO } }, overrideAccess: true })
  await payload.delete({ collection: 'events', where: { slug: { like: PREFIX } }, overrideAccess: true })
  await payload.delete({ collection: 'users', where: { email: { like: PREFIX } }, overrideAccess: true })
}

const makeEvent = (tenant: Tenant, name: string, organizers: User[]) =>
  payload.create({
    collection: 'events',
    data: {
      tenant: tenant.id,
      title: `${PREFIX}${name}`,
      slug: `${PREFIX}${name}`,
      startsAt: '2027-06-12T15:00:00.000Z',
      timeZone: 'Europe/Lisbon',
      published: true,
      organizers: organizers.map((user) => user.id),
    } as never,
    overrideAccess: true,
  })

describe('lookups that scope people and codes to one studio', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    studioA = await ensureTenant(payload, { name: 'Int Scope A', slug: 'int-scope-a' })
    studioB = await ensureTenant(payload, { name: 'Int Scope B', slug: 'int-scope-b' })
    await cleanup()
    organizerA = await makeUser('organizer-a', studioA, ['event-organizer'])
    adminA = await makeUser('admin-a', studioA, ['admin'])
    eventA = await makeEvent(studioA, 'gala-a', [organizerA])
    const organizerOfB = await makeUser('organizer-of-b', studioB, ['event-organizer'])
    eventB = await makeEvent(studioB, 'gala-b', [organizerOfB])
    await payload.create({
      collection: 'promo-codes',
      data: { event: eventA.id, code: PROMO, discountType: 'percent', percentOff: 10, active: true } as never,
      overrideAccess: true,
    })
  })

  afterAll(cleanup)

  it('lists an organizer’s events only while they are still a member of that event’s studio', async () => {
    expect(await organizedEventIds(payload, organizerA)).toEqual([eventA.id])

    // The app refuses an organizer who is not a member of the event's studio, so membership is
    // removed after the event exists, as when a studio takes a person off its team.
    const organizerB = await makeUser('organizer-b', studioB, ['event-organizer'])
    const eventOfB = await makeEvent(studioB, 'gala-b2', [organizerB])
    expect(await organizedEventIds(payload, organizerB)).toEqual([eventOfB.id])
    await payload.update({
      collection: 'users',
      id: organizerB.id,
      data: { tenants: [] },
      overrideAccess: true,
    })
    const removed = await payload.findByID({ collection: 'users', id: organizerB.id, depth: 0, overrideAccess: true })
    expect(await organizedEventIds(payload, removed)).toEqual([])
  })

  it('treats a studio admin as guest-list staff for their studio only', () => {
    expect(isGuestListStaff(adminA, studioA.id)).toBe(true)
    expect(isGuestListStaff(adminA, studioB.id)).toBe(false)
    expect(isGuestListStaff(null, studioA.id)).toBe(false)
  })

  it('applies a promo code to its own event, and not to an event of another studio', async () => {
    expect(await findPromoCode(payload, eventA.id, PROMO)).not.toBeNull()
    expect(await findPromoCode(payload, eventB.id, PROMO)).toBeNull()
  })
})
