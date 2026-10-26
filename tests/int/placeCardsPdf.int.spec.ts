import { createLocalReq, getPayload, type Payload, type PayloadRequest } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { downloadPlaceCards } from '@/lib/placeCardsPdf'
import config from '@/payload.config'
import type { Event, Tenant, User } from '@/payload-types'

import { ensureTenant } from '../helpers/seedTenant'

/** Place cards go to the studio's staff and the event's organizers, and to nobody else. */

const PREFIX = 'int-placecards-'
const password = 'int-Password-1'

let payload: Payload
let studioA: Tenant
let studioB: Tenant
let hostA: User
let otherHostA: User
let clientA: User
let managerA: User
let hostB: User
let wedding: Event

const makeUser = async (name: string, tenant: Tenant, roles: string[]) => {
  const created = await payload.create({
    collection: 'users',
    data: { email: `${PREFIX}${name}@angelus.test`, password, roles: ['user'], tenants: [{ tenant: tenant.id, roles: roles as never }] },
  })
  return payload.findByID({ collection: 'users', id: created.id, depth: 0 })
}

const download = async (user: User | null, eventId: number | string) => {
  const req = (await createLocalReq({}, payload)) as PayloadRequest
  req.user = user ? ({ ...user, collection: 'users' } as PayloadRequest['user']) : null
  ;(req as { searchParams: URLSearchParams }).searchParams = new URLSearchParams({ event: String(eventId) })
  return downloadPlaceCards(req)
}

const cleanup = async () => {
  await payload.delete({ collection: 'events', where: { slug: { like: PREFIX } }, overrideAccess: true })
  await payload.delete({ collection: 'users', where: { email: { like: PREFIX } } })
}

describe('place cards PDF', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    studioA = await ensureTenant(payload, { name: 'Int Place Cards A', slug: 'int-placecards-a' })
    studioB = await ensureTenant(payload, { name: 'Int Place Cards B', slug: 'int-placecards-b' })
    await cleanup()
    hostA = await makeUser('host-a', studioA, ['event-organizer'])
    otherHostA = await makeUser('other-host-a', studioA, ['event-organizer'])
    clientA = await makeUser('client-a', studioA, ['client'])
    managerA = await makeUser('manager-a', studioA, ['production-manager'])
    hostB = await makeUser('host-b', studioB, ['event-organizer'])
    wedding = await payload.create({
      collection: 'events',
      data: {
        tenant: studioA.id,
        title: `${PREFIX}wedding`,
        slug: `${PREFIX}wedding`,
        startsAt: '2027-06-12T15:00:00.000Z',
        timeZone: 'Europe/Lisbon',
        published: true,
        organizers: [hostA.id],
      },
      overrideAccess: true,
    })
    const head = await payload.create({ collection: 'event-tables', data: { event: wedding.id, name: 'Head', capacity: 8 } as never, overrideAccess: true })
    await payload.create({
      collection: 'event-guests',
      data: { event: wedding.id, name: 'Ana', partySize: 2, rsvpStatus: 'attending', attendingCount: 2, table: head.id } as never,
      overrideAccess: true,
    })
  })

  afterAll(cleanup)

  it("gives the event's organizer and the studio's staff the cards", async () => {
    for (const user of [hostA, managerA]) {
      const response = await download(user, wedding.id)
      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toBe('application/pdf')
      expect(response.headers.get('cache-control')).toBe('private, no-store')
      expect(response.headers.get('content-disposition')).toContain('place-cards-')
    }
  })

  it('refuses everyone else, and odd event ids', async () => {
    for (const user of [otherHostA, clientA, hostB]) expect((await download(user, wedding.id)).status).toBe(404)
    expect((await download(null, wedding.id)).status).toBe(401)
    for (const id of ['abc', '2147483648', '999999999']) expect((await download(hostA, id)).status).toBe(404)
  })
})
