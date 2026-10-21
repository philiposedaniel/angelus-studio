import { createLocalReq, getPayload, type Payload, type PayloadRequest } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { downloadSeatingPlan } from '@/lib/seatingPdf'
import config from '@/payload.config'
import type { Event, Tenant, User } from '@/payload-types'

import { ensureTenant } from '../helpers/seedTenant'

/** The seating plan PDF is for the event's studio staff only. */

const PREFIX = 'int-seatpdf-'
const password = 'int-Password-1'

let payload: Payload
let studioA: Tenant
let studioB: Tenant
let managerA: User
let managerB: User
let hostA: User
let event: Event

const makeUser = async (name: string, tenant: Tenant, roles: string[]) => {
  const created = await payload.create({
    collection: 'users',
    data: { email: `${PREFIX}${name}@angelus.test`, password, roles: ['user'], tenants: [{ tenant: tenant.id, roles: roles as never }] },
  })
  return payload.findByID({ collection: 'users', id: created.id, depth: 0 })
}

const download = async (user: User | null, eventId: string | number = event.id) => {
  const req = (await createLocalReq(user ? { user } : {}, payload)) as PayloadRequest
  req.user = user ? ({ ...user, collection: 'users' } as PayloadRequest['user']) : null
  ;(req as { searchParams: URLSearchParams }).searchParams = new URLSearchParams({ event: String(eventId) })
  return downloadSeatingPlan(req)
}

const cleanup = async () => {
  await payload.delete({ collection: 'events', where: { slug: { like: PREFIX } }, overrideAccess: true })
  await payload.delete({ collection: 'users', where: { email: { like: PREFIX } } })
}

describe('seating plan PDF', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    studioA = await ensureTenant(payload, { name: 'Int Seating PDF A', slug: 'int-seatpdf-a' })
    studioB = await ensureTenant(payload, { name: 'Int Seating PDF B', slug: 'int-seatpdf-b' })
    await cleanup()
    managerA = await makeUser('manager-a', studioA, ['production-manager'])
    managerB = await makeUser('manager-b', studioB, ['production-manager'])
    hostA = await makeUser('host-a', studioA, ['event-organizer'])
    event = await payload.create({
      collection: 'events',
      data: {
        tenant: studioA.id,
        title: `${PREFIX}Wedding`,
        slug: `${PREFIX}wedding`,
        startsAt: '2027-06-12T15:00:00.000Z',
        timeZone: 'Europe/Lisbon',
        published: true,
        organizers: [hostA.id],
      } as never,
      overrideAccess: true,
    })
    const table = await payload.create({
      collection: 'event-tables',
      data: { event: event.id, name: 'Table 1', capacity: 8 } as never,
      overrideAccess: true,
    })
    await payload.create({
      collection: 'event-guests',
      data: { event: event.id, name: `${PREFIX}Maria`, partySize: 2, table: table.id, staffNotes: 'Old friend of the bride' } as never,
      overrideAccess: true,
    })
  })

  afterAll(cleanup)

  it("gives the event's studio staff a PDF", async () => {
    const response = await download(managerA)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/pdf')
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    const bytes = new Uint8Array(await response.arrayBuffer())
    expect(Buffer.from(bytes.subarray(0, 5)).toString()).toBe('%PDF-')
    // Staff notes never reach the printout.
    expect(Buffer.from(bytes).toString('latin1')).not.toContain('Old friend')
  })

  it("refuses another studio's staff, the event's host and visitors", async () => {
    expect((await download(managerB)).status).toBe(404)
    expect((await download(hostA)).status).toBe(403)
    expect((await download(null)).status).toBe(401)
    expect((await download(managerA, 'abc')).status).toBe(404)
  })
})
