import { getPayload, type Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { idOf } from '@/lib/ids'
import config from '@/payload.config'
import type { Event, Tenant, User } from '@/payload-types'

import { ensureTenant } from '../helpers/seedTenant'

const PREFIX = 'int-seating-'
const password = 'int-Password-1'

let payload: Payload
let studioA: Tenant
let studioB: Tenant
let managerA: User
let managerB: User
let editorA: User
let eventA: Event
let otherEventA: Event
let eventB: Event

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

const makeEvent = (tenant: Tenant, slug: string) =>
  payload.create({
    collection: 'events',
    data: {
      tenant: tenant.id,
      title: `${PREFIX}${slug}`,
      slug: `${PREFIX}${slug}`,
      startsAt: '2027-06-12T15:00:00.000Z',
      timeZone: 'Europe/Lisbon',
      published: false,
    } as never,
    overrideAccess: true,
  })

const makeTable = (event: Event, name: string, extra: Record<string, unknown> = {}) =>
  payload.create({
    collection: 'event-tables',
    data: { event: event.id, name, capacity: 8, ...extra } as never,
    overrideAccess: true,
  })

const makeGuest = (event: Event, name: string, extra: Record<string, unknown> = {}) =>
  payload.create({
    collection: 'event-guests',
    data: { event: event.id, name: `${PREFIX}${name}`, partySize: 2, ...extra } as never,
    overrideAccess: true,
  })

const visibleTables = (id: number, user?: User) =>
  payload
    .find({ collection: 'event-tables', where: { id: { equals: id } }, user, overrideAccess: false })
    .then((r) => r.docs.length)
    .catch(() => 0)

const cleanup = async () => {
  await payload.delete({ collection: 'events', where: { slug: { like: PREFIX } }, overrideAccess: true })
  await payload.delete({ collection: 'users', where: { email: { like: PREFIX } } })
}

describe('event tables and seating', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    studioA = await ensureTenant(payload, { name: 'Int Studio A', slug: 'int-studio-a' })
    studioB = await ensureTenant(payload, { name: 'Int Studio B', slug: 'int-studio-b' })
    await cleanup()
    managerA = await makeUser('manager-a', studioA, ['production-manager'])
    managerB = await makeUser('manager-b', studioB, ['production-manager'])
    editorA = await makeUser('editor-a', studioA, ['editor'])
    eventA = await makeEvent(studioA, 'wedding-a')
    otherEventA = await makeEvent(studioA, 'gala-a')
    eventB = await makeEvent(studioB, 'wedding-b')
  })

  afterAll(cleanup)

  it('keeps tables to their own studio\'s admins and production managers', async () => {
    const table = await makeTable(eventA, 'Table 1')
    expect(idOf(table.tenant)).toBe(studioA.id)
    expect(await visibleTables(table.id, managerA)).toBe(1)
    for (const user of [managerB, editorA, undefined]) expect(await visibleTables(table.id, user)).toBe(0)
    await expect(
      payload.update({ collection: 'event-tables', id: table.id, data: { capacity: 2 }, user: managerB, overrideAccess: false }),
    ).rejects.toThrow()
    await expect(
      payload.create({
        collection: 'event-tables',
        data: { event: eventB.id, name: 'Sneaky', capacity: 4, tenant: studioB.id } as never,
        user: managerA,
        overrideAccess: false,
      }),
    ).rejects.toThrow()
    await expect(
      payload.create({ collection: 'event-tables', data: { event: eventA.id, name: 'Nope', capacity: 4 } as never, user: editorA, overrideAccess: false }),
    ).rejects.toThrow()
  })

  it('lets a manager add a table and seat a guest at it', async () => {
    const table = await payload.create({
      collection: 'event-tables',
      data: { event: eventA.id, name: 'Head table', capacity: 6 } as never,
      user: managerA,
      overrideAccess: false,
    })
    const guest = await makeGuest(eventA, 'Ana')
    const seated = await payload.update({
      collection: 'event-guests',
      id: guest.id,
      data: { table: table.id },
      user: managerA,
      overrideAccess: false,
    })
    expect(idOf(seated.table)).toBe(table.id)
  })

  it('refuses a duplicate table name within an event, but not across events', async () => {
    await makeTable(eventA, 'Jasmine')
    await expect(makeTable(eventA, 'Jasmine')).rejects.toThrow(/already has a table/)
    await expect(makeTable(otherEventA, 'Jasmine')).resolves.toBeTruthy()
  })

  it('only seats a guest at one of their own event\'s tables', async () => {
    const elsewhere = await makeTable(otherEventA, 'Gala 1')
    const otherStudio = await makeTable(eventB, 'B 1')
    await expect(makeGuest(eventA, 'Rui', { table: elsewhere.id })).rejects.toThrow(/this event's tables/)
    await expect(makeGuest(eventA, 'Eva', { table: otherStudio.id })).rejects.toThrow(/this event's tables/)

    // Moving a seated guest to another event without changing the table is refused too.
    const here = await makeTable(eventA, 'Table 7')
    const guest = await makeGuest(eventA, 'Leo', { table: here.id })
    await expect(
      payload.update({ collection: 'event-guests', id: guest.id, data: { event: otherEventA.id }, overrideAccess: true }),
    ).rejects.toThrow(/this event's tables/)
  })

  it('unseats guests when their table is removed, and removes tables with their event', async () => {
    const event = await makeEvent(studioA, 'party-a')
    const table = await makeTable(event, 'Table 9')
    const guest = await makeGuest(event, 'Mia', { table: table.id })
    await payload.delete({ collection: 'event-tables', id: table.id, overrideAccess: true })
    const after = await payload.findByID({ collection: 'event-guests', id: guest.id, depth: 0 })
    expect(after.table ?? null).toBeNull()

    const again = await makeTable(event, 'Table 10')
    await payload.delete({ collection: 'events', id: event.id, overrideAccess: true })
    const { totalDocs } = await payload.count({ collection: 'event-tables', where: { id: { equals: again.id } } })
    expect(totalDocs).toBe(0)
  })
})
