import { getPayload, type Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { guestListQuery, guestListWhere, readGuestListFilter } from '@/lib/organizerGuests'
import config from '@/payload.config'
import type { Event, EventTable, Tenant, User } from '@/payload-types'

import { ensureTenant } from '../helpers/seedTenant'

/** An organizer narrows their guest list by reply and table, and never reaches another event's guests. */

const PREFIX = 'int-orgfilter-'
const password = 'int-Password-1'

let payload: Payload
let studio: Tenant
let hostA: User
let wedding: Event
let gala: Event
let head: EventTable
let galaTable: EventTable

const makeEvent = (slug: string, organizers: number[]) =>
  payload.create({
    collection: 'events',
    data: {
      tenant: studio.id,
      title: `${PREFIX}${slug}`,
      slug: `${PREFIX}${slug}`,
      startsAt: '2027-06-12T15:00:00.000Z',
      timeZone: 'Europe/Lisbon',
      published: true,
      organizers,
    },
    overrideAccess: true,
  })

const guest = (event: Event, name: string, data: Record<string, unknown> = {}) =>
  payload.create({ collection: 'event-guests', data: { event: event.id, name, partySize: 2, ...data } as never, overrideAccess: true })

const names = async (event: Event, query: Record<string, string>) =>
  (
    await payload.find({
      collection: 'event-guests',
      where: guestListWhere(event.id, readGuestListFilter(query)),
      sort: 'name',
      user: hostA,
      overrideAccess: false,
    })
  ).docs.map((g) => g.name)

const cleanup = async () => {
  await payload.delete({ collection: 'events', where: { slug: { like: PREFIX } }, overrideAccess: true })
  await payload.delete({ collection: 'users', where: { email: { like: PREFIX } } })
}

describe('organizer guest list filters', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    studio = await ensureTenant(payload, { name: 'Int Organizer Filters', slug: 'int-orgfilter' })
    await cleanup()
    const created = await payload.create({
      collection: 'users',
      data: { email: `${PREFIX}host@angelus.test`, password, roles: ['user'], tenants: [{ tenant: studio.id, roles: ['event-organizer'] }] },
    })
    hostA = await payload.findByID({ collection: 'users', id: created.id, depth: 0 })
    wedding = await makeEvent('wedding', [hostA.id])
    gala = await makeEvent('gala', [])
    head = await payload.create({ collection: 'event-tables', data: { event: wedding.id, name: 'Head', capacity: 8 } as never, overrideAccess: true })
    galaTable = await payload.create({ collection: 'event-tables', data: { event: gala.id, name: 'Gala', capacity: 8 } as never, overrideAccess: true })
    await guest(wedding, 'Ana', { rsvpStatus: 'attending', attendingCount: 2, table: head.id })
    await guest(wedding, 'Bruno', { rsvpStatus: 'declined' })
    await guest(wedding, 'Carla')
    await guest(gala, 'Gil', { table: galaTable.id })
  })

  afterAll(cleanup)

  it('narrows by reply, by table and by no table', async () => {
    expect(await names(wedding, {})).toEqual(['Ana', 'Bruno', 'Carla'])
    expect(await names(wedding, { reply: 'attending' })).toEqual(['Ana'])
    expect(await names(wedding, { reply: 'declined' })).toEqual(['Bruno'])
    expect(await names(wedding, { reply: 'pending' })).toEqual(['Carla'])
    expect(await names(wedding, { table: String(head.id) })).toEqual(['Ana'])
    expect(await names(wedding, { table: 'none' })).toEqual(['Bruno', 'Carla'])
    expect(await names(wedding, { table: 'none', reply: 'pending', q: 'car' })).toEqual(['Carla'])
  })

  it("ignores filters it does not know, and finds nobody through another event's table", async () => {
    expect(await names(wedding, { reply: 'maybe', table: 'x; drop' })).toEqual(['Ana', 'Bruno', 'Carla'])
    // Ids past the database's integer range are ignored rather than sent to Postgres.
    for (const table of ['2147483648', '999999999999', '0'])
      expect(await names(wedding, { table })).toEqual(['Ana', 'Bruno', 'Carla'])
    expect(await names(wedding, { table: String(galaTable.id) })).toEqual([])
    expect(await names(gala, {})).toEqual([])
  })

  it('keeps the filters in page links', () => {
    expect(guestListQuery(readGuestListFilter({ q: ' ana ', reply: 'attending', table: 'none' }), 2)).toBe(
      '?q=ana&reply=attending&table=none&page=2',
    )
    expect(guestListQuery(readGuestListFilter({}))).toBe('')
  })
})
