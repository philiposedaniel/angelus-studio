import { createLocalReq, getPayload, type Payload, type PayloadRequest } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { exportAttendees } from '@/lib/attendees'
import config from '@/payload.config'
import type { Event, Registration, Tenant, User } from '@/payload-types'

import { ensureTenant } from '../helpers/seedTenant'

const PREFIX = 'int-attendees-'
const password = 'int-Password-1'

let payload: Payload
let studioA: Tenant
let studioB: Tenant
let managerA: User
let managerB: User
let editorA: User
let eventA: Event
let maria: Registration

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

/** A request as the endpoint would get it, signed in as `user`. */
const request = async (user: User | null, event: number | string) => {
  const req = (await createLocalReq({ user: user ?? undefined }, payload)) as PayloadRequest
  req.user = user ? ({ ...user, collection: 'users' } as PayloadRequest['user']) : null
  ;(req as { searchParams: URLSearchParams }).searchParams = new URLSearchParams({ event: String(event) })
  return req
}

const cleanup = async () => {
  await payload.delete({ collection: 'events', where: { slug: { like: PREFIX } }, overrideAccess: true })
  await payload.delete({ collection: 'users', where: { email: { like: PREFIX } } })
}

describe('attendee list download', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    studioA = await ensureTenant(payload, { name: 'Int Studio A', slug: 'int-studio-a' })
    studioB = await ensureTenant(payload, { name: 'Int Studio B', slug: 'int-studio-b' })
    await cleanup()
    managerA = await makeUser('manager-a', studioA, ['production-manager'])
    managerB = await makeUser('manager-b', studioB, ['production-manager'])
    editorA = await makeUser('editor-a', studioA, ['editor'])
    eventA = await payload.create({
      collection: 'events',
      data: {
        tenant: studioA.id,
        title: `${PREFIX}Open day`,
        slug: `${PREFIX}open-day`,
        startsAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
        timeZone: 'Europe/Lisbon',
        published: true,
        listed: true,
      } as never,
      overrideAccess: true,
    })
    const general = await payload.create({
      collection: 'ticket-types',
      data: { event: eventA.id, name: 'General admission', capacity: 50, maxPerOrder: 5 } as never,
      overrideAccess: true,
    })
    maria = await payload.create({
      collection: 'registrations',
      data: { ticketType: general.id, name: 'Maria Silva', email: 'maria@example.com', quantity: 2, checkedInCount: 1 } as never,
      overrideAccess: true,
    })
    await payload.create({
      collection: 'registrations',
      data: { ticketType: general.id, name: '=HYPERLINK("http://evil.test")', email: 'odd@example.com', quantity: 1 } as never,
      overrideAccess: true,
    })
    const cancelled = await payload.create({
      collection: 'registrations',
      data: { ticketType: general.id, name: 'Zé Cancelado', email: 'ze@example.com', quantity: 1 } as never,
      overrideAccess: true,
    })
    await payload.update({ collection: 'registrations', id: cancelled.id, data: { status: 'cancelled' }, overrideAccess: true })
  })

  afterAll(cleanup)

  it("gives the studio's managers the attendee list with each ticket link", async () => {
    const response = await exportAttendees(await request(managerA, eventA.id))
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/csv')
    expect(response.headers.get('content-disposition')).toContain(`attendees-${PREFIX}open-day.csv`)
    const text = await response.text()
    const lines = text.trim().split('\r\n')
    expect(lines[0]).toContain('Name,Email,Phone,Ticket,Places,Status')
    expect(lines).toHaveLength(4)
    expect(text).toContain('Maria Silva,maria@example.com,,General admission,2,Confirmed,0.00')
    expect(text).toContain(`/en/tickets/${maria.ticketToken}`)
    expect(text).toContain('Zé Cancelado,ze@example.com,,General admission,1,Cancelled')
    // A name that a spreadsheet would run as a formula is kept as text.
    expect(text).toContain(`"'=HYPERLINK(""http://evil.test"")"`)
  })

  it('refuses other studios, editors and visitors', async () => {
    for (const user of [managerB, editorA]) {
      expect([403, 404]).toContain((await exportAttendees(await request(user, eventA.id))).status)
    }
    expect((await exportAttendees(await request(null, eventA.id))).status).toBe(401)
    expect((await exportAttendees(await request(managerA, 'abc'))).status).toBe(404)
  })
})
