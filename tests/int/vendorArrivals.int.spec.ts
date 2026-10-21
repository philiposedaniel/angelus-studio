import { getPayload, type Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { eventArrivals } from '@/lib/vendors'
import config from '@/payload.config'
import type { Event, EventVendor, Tenant, Vendor } from '@/payload-types'

import { ensureTenant } from '../helpers/seedTenant'

/** A vendor's page lists the day's arrivals by role and time, never other vendors' details. */

const PREFIX = 'int-arrivals-'

let payload: Payload
let studioA: Tenant
let studioB: Tenant
let wedding: Event
let otherEvent: Event
let eventB: Event
let band: Vendor
let vendorB: Vendor

const makeEvent = (tenant: Tenant, slug: string) =>
  payload.create({
    collection: 'events',
    data: { tenant: tenant.id, title: `${PREFIX}${slug}`, slug: `${PREFIX}${slug}`, startsAt: '2027-06-12T15:00:00.000Z', timeZone: 'Europe/Lisbon', published: true } as never,
    overrideAccess: true,
  })

const book = (event: Event, vendor: Vendor, role: string, status: string, arrivalAt?: string) =>
  payload.create({
    collection: 'event-vendors',
    data: { event: event.id, vendor: vendor.id, role, status, arrivalAt, currency: 'eur', amountDue: 90000, staffNotes: 'Pays late' } as never,
    overrideAccess: true,
  }) as Promise<EventVendor>

const cleanup = async () => {
  await payload.delete({ collection: 'events', where: { slug: { like: PREFIX } }, overrideAccess: true })
  await payload.delete({ collection: 'vendors', where: { name: { like: PREFIX } }, overrideAccess: true })
}

describe("a vendor's view of the day's arrivals", () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    studioA = await ensureTenant(payload, { name: 'Int Arrivals A', slug: 'int-arrivals-a' })
    studioB = await ensureTenant(payload, { name: 'Int Arrivals B', slug: 'int-arrivals-b' })
    await cleanup()
    wedding = await makeEvent(studioA, 'wedding')
    otherEvent = await makeEvent(studioA, 'gala')
    eventB = await makeEvent(studioB, 'party')
    band = await payload.create({ collection: 'vendors', data: { tenant: studioA.id, name: `${PREFIX}Band`, category: 'music', phone: '+351 911 111 111' } as never, overrideAccess: true })
    vendorB = await payload.create({ collection: 'vendors', data: { tenant: studioB.id, name: `${PREFIX}Other`, category: 'music' } as never, overrideAccess: true })
  })

  afterAll(cleanup)

  it('lists booked and confirmed roles on the same event in arrival order, marking the reader', async () => {
    const mine = await book(wedding, band, 'Live band', 'confirmed', '2027-06-12T13:00:00.000Z')
    await book(wedding, band, 'Florist', 'booked', '2027-06-12T09:00:00.000Z')
    await book(wedding, band, 'Caterer', 'booked')
    await book(wedding, band, 'Maybe a magician', 'proposed', '2027-06-12T10:00:00.000Z')
    await book(wedding, band, 'Cancelled DJ', 'cancelled', '2027-06-12T11:00:00.000Z')
    await book(otherEvent, band, 'Gala band', 'booked', '2027-06-12T08:00:00.000Z')
    await book(eventB, vendorB, 'Other studio DJ', 'booked', '2027-06-12T08:00:00.000Z')

    const arrivals = await eventArrivals(payload, mine)
    expect(arrivals.map((row) => row.role)).toEqual(['Florist', 'Live band', 'Caterer'])
    expect(arrivals.find((row) => row.you)?.role).toBe('Live band')
    // Only the role, the time and whether it is the reader leave the studio.
    for (const row of arrivals) expect(Object.keys(row).sort()).toEqual(['arrivalAt', 'role', 'you'])
    expect(JSON.stringify(arrivals)).not.toMatch(/Pays late|90000|\+351|Band/)
  })

  it("gives nothing when the booking's tenant does not match its event's studio", async () => {
    const theirs = await book(eventB, vendorB, 'Their DJ', 'booked', '2027-06-12T08:00:00.000Z')
    const arrivals = await eventArrivals(payload, { ...theirs, tenant: studioA.id })
    expect(arrivals).toEqual([])
  })
})
