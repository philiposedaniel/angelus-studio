import { createLocalReq, getPayload, type Payload, type PayloadRequest } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { idOf } from '@/lib/ids'
import { saveGuestFromPortal } from '@/lib/organizerGuests'
import { downloadSeatingPlan } from '@/lib/seatingPdf'
import config from '@/payload.config'
import type { Event, EventGuest, EventTable, Tenant, User } from '@/payload-types'

import { ensureTenant } from '../helpers/seedTenant'

/** An event's organizers see its tables and seat their guests; only staff set the tables up. */

const PREFIX = 'int-orgseat-'
const password = 'int-Password-1'
const offeredLanguages = ['en'] as const

let payload: Payload
let studioA: Tenant
let studioB: Tenant
let hostA: User
let otherHostA: User
let hostB: User
let wedding: Event
let gala: Event
let eventB: Event
let head: EventTable
let galaTable: EventTable
let tableB: EventTable
let maria: EventGuest

const makeUser = async (name: string, tenant: Tenant, roles: string[]) => {
  const created = await payload.create({
    collection: 'users',
    data: { email: `${PREFIX}${name}@angelus.test`, password, roles: ['user'], tenants: [{ tenant: tenant.id, roles: roles as never }] },
  })
  return payload.findByID({ collection: 'users', id: created.id, depth: 0 })
}

const makeEvent = (tenant: Tenant, slug: string, organizers: number[]) =>
  payload.create({
    collection: 'events',
    data: {
      tenant: tenant.id,
      title: `${PREFIX}${slug}`,
      slug: `${PREFIX}${slug}`,
      startsAt: '2027-06-12T15:00:00.000Z',
      timeZone: 'Europe/Lisbon',
      published: true,
      organizers,
    },
    overrideAccess: true,
  })

const makeTable = (event: Event, name: string) =>
  payload.create({
    collection: 'event-tables',
    data: { event: event.id, name, capacity: 8, notes: 'Next to the speakers' } as never,
    overrideAccess: true,
  })

const tablesFor = async (eventId: number, user: User) =>
  (
    await payload.find({
      collection: 'event-tables',
      where: { event: { equals: eventId } },
      user,
      overrideAccess: false,
    })
  ).docs

const form = (values: Record<string, string | number>) => {
  const data = new FormData()
  for (const [key, value] of Object.entries(values)) data.set(key, String(value))
  return data
}

const download = async (user: User, eventId: number) => {
  const req = (await createLocalReq({ user }, payload)) as PayloadRequest
  req.user = { ...user, collection: 'users' } as PayloadRequest['user']
  ;(req as { searchParams: URLSearchParams }).searchParams = new URLSearchParams({ event: String(eventId) })
  return downloadSeatingPlan(req)
}

const cleanup = async () => {
  await payload.delete({ collection: 'events', where: { slug: { like: PREFIX } }, overrideAccess: true })
  await payload.delete({ collection: 'users', where: { email: { like: PREFIX } } })
}

describe('seating for event organizers', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    studioA = await ensureTenant(payload, { name: 'Int Organizer Seating A', slug: 'int-orgseat-a' })
    studioB = await ensureTenant(payload, { name: 'Int Organizer Seating B', slug: 'int-orgseat-b' })
    await cleanup()
    hostA = await makeUser('host-a', studioA, ['event-organizer'])
    otherHostA = await makeUser('other-host-a', studioA, ['event-organizer'])
    hostB = await makeUser('host-b', studioB, ['event-organizer'])
    wedding = await makeEvent(studioA, 'wedding', [hostA.id])
    gala = await makeEvent(studioA, 'gala', [otherHostA.id])
    eventB = await makeEvent(studioB, 'party', [hostB.id])
    head = await makeTable(wedding, 'Head table')
    galaTable = await makeTable(gala, 'Gala 1')
    tableB = await makeTable(eventB, 'B 1')
    maria = await payload.create({
      collection: 'event-guests',
      data: { event: wedding.id, name: `${PREFIX}Maria`, partySize: 2 } as never,
      overrideAccess: true,
    })
  })

  afterAll(cleanup)

  it("shows an organizer their own event's tables, without the studio's notes", async () => {
    const tables = await tablesFor(wedding.id, hostA)
    expect(tables.map((table) => table.name)).toEqual(['Head table'])
    expect(tables[0]!.notes).toBeUndefined()
  })

  it("keeps other events' tables away, in the same studio and in another", async () => {
    expect(await tablesFor(gala.id, hostA)).toHaveLength(0)
    expect(await tablesFor(eventB.id, hostA)).toHaveLength(0)
    expect(await tablesFor(wedding.id, hostB)).toHaveLength(0)
    await expect(
      payload.findByID({ collection: 'event-tables', id: tableB.id, user: hostA, overrideAccess: false }),
    ).rejects.toThrow()
  })

  it('does not let organizers add, change or remove tables', async () => {
    await expect(
      payload.create({
        collection: 'event-tables',
        data: { event: wedding.id, name: 'Sneaky', capacity: 4 } as never,
        user: hostA,
        overrideAccess: false,
      }),
    ).rejects.toThrow()
    await expect(
      payload.update({ collection: 'event-tables', id: head.id, data: { capacity: 50 }, user: hostA, overrideAccess: false }),
    ).rejects.toThrow()
    await expect(payload.delete({ collection: 'event-tables', id: head.id, user: hostA, overrideAccess: false })).rejects.toThrow()
    const unchanged = await payload.findByID({ collection: 'event-tables', id: head.id, overrideAccess: true })
    expect(unchanged.capacity).toBe(8)
  })

  it("lets an organizer seat a guest at their event's table, and clear it", async () => {
    const seated = await saveGuestFromPortal({
      payload,
      user: hostA,
      offeredLanguages,
      form: form({ intent: 'save', event: wedding.id, guest: maria.id, name: maria.name, partySize: 2, language: 'en', table: head.id }),
    })
    expect(seated).toEqual({ status: 'saved', action: 'updated' })
    expect(idOf((await payload.findByID({ collection: 'event-guests', id: maria.id, overrideAccess: true })).table)).toBe(head.id)

    const cleared = await saveGuestFromPortal({
      payload,
      user: hostA,
      offeredLanguages,
      form: form({ intent: 'save', event: wedding.id, guest: maria.id, name: maria.name, partySize: 2, language: 'en', table: '' }),
    })
    expect(cleared).toEqual({ status: 'saved', action: 'updated' })
    expect((await payload.findByID({ collection: 'event-guests', id: maria.id, overrideAccess: true })).table ?? null).toBeNull()
  })

  it("refuses a table from another event or another studio", async () => {
    for (const table of [galaTable, tableB]) {
      const result = await saveGuestFromPortal({
        payload,
        user: hostA,
        offeredLanguages,
        form: form({ intent: 'save', event: wedding.id, guest: maria.id, name: maria.name, partySize: 2, language: 'en', table: table.id }),
      })
      expect(result).toEqual({ status: 'error', errors: { table: 'invalid' } })
    }
    expect(
      await saveGuestFromPortal({
        payload,
        user: hostA,
        offeredLanguages,
        form: form({ intent: 'save', event: wedding.id, guest: maria.id, name: maria.name, partySize: 2, language: 'en', table: 'x' }),
      }),
    ).toEqual({ status: 'error', errors: { table: 'invalid' } })
    expect((await payload.findByID({ collection: 'event-guests', id: maria.id, overrideAccess: true })).table ?? null).toBeNull()
  })

  it('gives an organizer the seating plan PDF of their own event only', async () => {
    const own = await download(hostA, wedding.id)
    expect(own.status).toBe(200)
    expect(own.headers.get('content-type')).toBe('application/pdf')
    expect(Buffer.from(await own.arrayBuffer()).toString('latin1')).not.toContain('speakers')
    expect((await download(hostA, gala.id)).status).toBe(404)
    expect((await download(hostA, eventB.id)).status).toBe(404)
    expect((await download(hostB, wedding.id)).status).toBe(404)
  })
})
