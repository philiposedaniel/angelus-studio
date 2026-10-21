import { getPayload, type Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { idOf } from '@/lib/ids'
import { seatGuestsFromPortal } from '@/lib/organizerGuests'
import config from '@/payload.config'
import type { Event, EventGuest, EventTable, Tenant, User } from '@/payload-types'

import { ensureTenant } from '../helpers/seedTenant'

/** An event's organizers seat several ticked guests at once, only their own event's guests and tables. */

const PREFIX = 'int-orgbulk-'
const password = 'int-Password-1'

let payload: Payload
let studioA: Tenant
let studioB: Tenant
let hostA: User
let otherHostA: User
let hostB: User
let managerA: User
let wedding: Event
let gala: Event
let head: EventTable
let galaTable: EventTable
let ana: EventGuest
let rui: EventGuest
let gil: EventGuest

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

const seat = (user: User, event: Event | number, guests: (EventGuest | number | string)[], table: EventTable | string) => {
  const form = new FormData()
  form.set('event', String(typeof event === 'number' ? event : event.id))
  form.set('table', typeof table === 'string' ? table : String(table.id))
  for (const guest of guests) form.append('guest', String(typeof guest === 'object' ? guest.id : guest))
  return seatGuestsFromPortal({ payload, user, form })
}

const tableOf = async (guest: EventGuest) =>
  idOf((await payload.findByID({ collection: 'event-guests', id: guest.id, depth: 0, overrideAccess: true })).table) ?? null

const cleanup = async () => {
  await payload.delete({ collection: 'events', where: { slug: { like: PREFIX } }, overrideAccess: true })
  await payload.delete({ collection: 'users', where: { email: { like: PREFIX } } })
}

describe('seating several guests at once from the organizer portal', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    studioA = await ensureTenant(payload, { name: 'Int Organizer Bulk A', slug: 'int-orgbulk-a' })
    studioB = await ensureTenant(payload, { name: 'Int Organizer Bulk B', slug: 'int-orgbulk-b' })
    await cleanup()
    hostA = await makeUser('host-a', studioA, ['event-organizer'])
    otherHostA = await makeUser('other-host-a', studioA, ['event-organizer'])
    hostB = await makeUser('host-b', studioB, ['event-organizer'])
    managerA = await makeUser('manager-a', studioA, ['production-manager'])
    wedding = await makeEvent(studioA, 'wedding', [hostA.id])
    gala = await makeEvent(studioA, 'gala', [otherHostA.id])
    head = await payload.create({ collection: 'event-tables', data: { event: wedding.id, name: 'Head', capacity: 8 } as never, overrideAccess: true })
    galaTable = await payload.create({ collection: 'event-tables', data: { event: gala.id, name: 'Gala', capacity: 8 } as never, overrideAccess: true })
    const guest = (event: Event, name: string) =>
      payload.create({ collection: 'event-guests', data: { event: event.id, name, partySize: 2 } as never, overrideAccess: true })
    ana = await guest(wedding, 'Ana')
    rui = await guest(wedding, 'Rui')
    gil = await guest(gala, 'Gil')
  })

  afterAll(cleanup)

  it('seats the ticked guests at a table of the event, then takes them off it', async () => {
    expect(await seat(hostA, wedding, [ana, rui, ana], head)).toEqual({ status: 'seated', count: 2, cleared: false })
    expect(await tableOf(ana)).toBe(head.id)
    expect(await tableOf(rui)).toBe(head.id)
    expect(await seat(hostA, wedding, [rui], '')).toEqual({ status: 'seated', count: 1, cleared: true })
    expect(await tableOf(rui)).toBeNull()
    expect(await tableOf(ana)).toBe(head.id)
  })

  it("leaves another event's guests alone even when their ids are sent", async () => {
    expect(await seat(hostA, wedding, [rui, gil], head)).toEqual({ status: 'seated', count: 1, cleared: false })
    expect(await tableOf(gil)).toBeNull()
    expect(await seat(hostA, wedding, [gil], head)).toEqual({ status: 'error', reason: 'forbidden' })
    expect(await tableOf(gil)).toBeNull()
  })

  it("refuses another event's table, and odd values", async () => {
    expect(await seat(hostA, wedding, [ana], galaTable)).toEqual({ status: 'error', reason: 'invalidTable' })
    expect(await seat(hostA, wedding, [ana], '2147483648')).toEqual({ status: 'error', reason: 'invalidTable' })
    expect(await seat(hostA, wedding, [ana], 'x')).toEqual({ status: 'error', reason: 'invalidTable' })
    expect(await seat(hostA, wedding, [], head)).toEqual({ status: 'error', reason: 'noneSelected' })
    expect(await seat(hostA, wedding, ['abc', '2147483648'], head)).toEqual({ status: 'error', reason: 'noneSelected' })
    expect(await seat(hostA, wedding, Array.from({ length: 101 }, (_, i) => i + 1), head)).toEqual({
      status: 'error',
      reason: 'failed',
    })
    expect(await tableOf(ana)).toBe(head.id)
  })

  it("refuses hosts of other events and other studios", async () => {
    expect(await seat(otherHostA, wedding, [ana], '')).toEqual({ status: 'error', reason: 'forbidden' })
    expect(await seat(hostB, wedding, [ana], '')).toEqual({ status: 'error', reason: 'forbidden' })
    expect(await seat(hostA, gala, [gil], galaTable)).toEqual({ status: 'error', reason: 'forbidden' })
    expect(await seat(hostA, 999_999_999, [ana], '')).toEqual({ status: 'error', reason: 'forbidden' })
    expect(await tableOf(ana)).toBe(head.id)
    expect(await tableOf(gil)).toBeNull()
  })

  it('lets studio staff seat guests too', async () => {
    expect(await seat(managerA, gala, [gil], galaTable)).toEqual({ status: 'seated', count: 1, cleared: false })
    expect(await tableOf(gil)).toBe(galaTable.id)
  })
})
