import { getPayload, type Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { importGuestsFromPortal } from '@/lib/organizerGuests'
import config from '@/payload.config'
import type { Event, Tenant, User } from '@/payload-types'

import { ensureTenant } from '../helpers/seedTenant'

/** An event's organizers add guests from a spreadsheet in the portal, to their own events only. */

const PREFIX = 'int-orgimport-'
const password = 'int-Password-1'

let payload: Payload
let studioA: Tenant
let studioB: Tenant
let hostA: User
let otherHostA: User
let clientA: User
let hostB: User
let managerA: User
let wedding: Event
let gala: Event

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

const CSV = [
  'Name,Email,Party size,Group',
  'Ana Costa,ana@example.com,2,Family',
  'Rui Lopes,,1,Friends',
  ',nobody@example.com,1,',
  'Bea,bea@example.com,99,',
].join('\n')

const send = (user: User, event: Event | number, intent: 'check' | 'add', csv: string | null = CSV) => {
  const form = new FormData()
  form.set('event', String(typeof event === 'number' ? event : event.id))
  form.set('intent', intent)
  if (csv !== null) form.set('file', new File([csv], 'guests.csv', { type: 'text/csv' }))
  return importGuestsFromPortal({ payload, user, form })
}

const guestNames = async (event: Event) =>
  (
    await payload.find({ collection: 'event-guests', where: { event: { equals: event.id } }, sort: 'name', overrideAccess: true })
  ).docs.map((guest) => guest.name)

const cleanup = async () => {
  await payload.delete({ collection: 'events', where: { slug: { like: PREFIX } }, overrideAccess: true })
  await payload.delete({ collection: 'users', where: { email: { like: PREFIX } } })
}

describe('guest import from the organizer portal', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    studioA = await ensureTenant(payload, { name: 'Int Organizer Import A', slug: 'int-orgimport-a' })
    studioB = await ensureTenant(payload, { name: 'Int Organizer Import B', slug: 'int-orgimport-b' })
    await cleanup()
    hostA = await makeUser('host-a', studioA, ['event-organizer'])
    otherHostA = await makeUser('other-host-a', studioA, ['event-organizer'])
    clientA = await makeUser('client-a', studioA, ['client'])
    hostB = await makeUser('host-b', studioB, ['event-organizer'])
    managerA = await makeUser('manager-a', studioA, ['production-manager'])
    wedding = await makeEvent(studioA, 'wedding', [hostA.id])
    gala = await makeEvent(studioA, 'gala', [otherHostA.id])
  })

  afterAll(cleanup)

  it('checks the file first and adds nobody, naming the rows with problems', async () => {
    const checked = await send(hostA, wedding, 'check')
    expect(checked).toMatchObject({ status: 'checked', ready: 2, duplicates: 0, added: 0 })
    if (checked.status !== 'checked') return
    expect(checked.problems).toEqual([
      { line: 4, code: 'nameMissing' },
      { line: 5, code: 'partySize' },
    ])
    expect(checked.preview).toEqual([
      { name: 'Ana Costa', partySize: 2 },
      { name: 'Rui Lopes', partySize: 1 },
    ])
    expect(await guestNames(wedding)).toEqual([])
  })

  it("adds the guests to the organizer's own event, once", async () => {
    expect(await send(hostA, wedding, 'add')).toMatchObject({ status: 'added', added: 2 })
    expect(await guestNames(wedding)).toEqual(['Ana Costa', 'Rui Lopes'])
    // Ana is matched by email the second time; Rui has none, so he is added again.
    expect(await send(hostA, wedding, 'check')).toMatchObject({ status: 'checked', ready: 1, duplicates: 1 })
  })

  it("refuses other events, other studios' hosts and the studio's other clients", async () => {
    for (const [user, event] of [
      [hostA, gala],
      [otherHostA, wedding],
      [clientA, wedding],
      [hostB, wedding],
    ] as const) {
      expect(await send(user, event, 'add')).toEqual({ status: 'error', reason: 'forbidden' })
    }
    expect(await send(hostA, 999_999_999, 'add')).toEqual({ status: 'error', reason: 'forbidden' })
    expect(await guestNames(gala)).toEqual([])
    expect(await guestNames(wedding)).toEqual(['Ana Costa', 'Rui Lopes'])
  })

  it('lets studio staff use it too', async () => {
    expect(await send(managerA, gala, 'add', 'Name\nCarla')).toMatchObject({ status: 'added', added: 1 })
    expect(await guestNames(gala)).toEqual(['Carla'])
  })

  it('explains a missing file or one without a Name column', async () => {
    expect(await send(hostA, wedding, 'check', null)).toEqual({ status: 'error', reason: 'noFile' })
    expect(await send(hostA, wedding, 'check', 'Email\nx@example.com')).toEqual({ status: 'error', reason: 'noNameColumn' })
    expect(await send(hostA, wedding, 'check', 'Name\n')).toEqual({ status: 'error', reason: 'empty' })
  })
})
