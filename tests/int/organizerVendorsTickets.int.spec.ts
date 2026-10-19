import { createLocalReq, getPayload, type Payload, type PayloadRequest } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { eventTicketSales } from '@/lib/tickets'
import { sendVendorLink } from '@/lib/vendors'
import config from '@/payload.config'
import type { Event, EventVendor, Tenant, TicketType, User, Vendor } from '@/payload-types'

import { ensureTenant } from '../helpers/seedTenant'

/** An event's organizers see who is working it and how tickets sell, never money or notes. */

const PREFIX = 'int-orgview-'
const password = 'int-Password-1'

let payload: Payload
let studioA: Tenant
let studioB: Tenant
let hostA: User
let otherClientA: User
let hostB: User
let managerA: User
let wedding: Event
let gala: Event
let dj: Vendor
let florist: Vendor
let caterer: Vendor
let booked: EventVendor
let proposed: EventVendor
let galaBooking: EventVendor
let general: TicketType

const makeUser = async (name: string, tenant: Tenant, roles: string[]) => {
  const created = await payload.create({
    collection: 'users',
    data: { email: `${PREFIX}${name}@angelus.test`, password, roles: ['user'], tenants: [{ tenant: tenant.id, roles: roles as never }] },
  })
  return payload.findByID({ collection: 'users', id: created.id, depth: 0 })
}

const makeEvent = (tenant: Tenant, slug: string, organizers: number[] = []) =>
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

const makeVendor = (tenant: Tenant, name: string) =>
  payload.create({
    collection: 'vendors',
    data: {
      tenant: tenant.id,
      name: `${PREFIX}${name}`,
      category: 'music',
      contactName: 'Rui',
      email: `${PREFIX}${name.toLowerCase()}@vendors.test`,
      phone: '+351 900 000 000',
      notes: 'Charges extra after midnight',
    } as never,
    overrideAccess: true,
  })

const book = (event: Event, vendor: Vendor, status: string) =>
  payload.create({
    collection: 'event-vendors',
    data: {
      event: event.id,
      vendor: vendor.id,
      role: `${vendor.name} role`,
      status,
      arrivalAt: '2027-06-12T13:00:00.000Z',
      instructions: 'Use the side gate.',
      currency: 'eur',
      amountDue: 120000,
      amountPaid: 50000,
      paymentDueDate: '2027-06-01',
      staffNotes: 'Negotiated down from 1500',
    } as never,
    overrideAccess: true,
  })

const readAs = <T extends 'event-vendors' | 'vendors' | 'ticket-types'>(collection: T, user: User, where = {}) =>
  payload
    .find({ collection, where, depth: 0, pagination: false, user, overrideAccess: false })
    .then((result) => result.docs as Record<string, unknown>[])
    .catch(() => [] as Record<string, unknown>[])

const ids = (docs: Record<string, unknown>[]) => docs.map((doc) => doc.id).sort()

const cleanup = async () => {
  await payload.delete({ collection: 'events', where: { slug: { like: PREFIX } }, overrideAccess: true })
  await payload.delete({ collection: 'vendors', where: { name: { like: PREFIX } }, overrideAccess: true })
  await payload.delete({ collection: 'users', where: { email: { like: PREFIX } } })
}

describe("an organizer's view of vendors and tickets", () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    studioA = await ensureTenant(payload, { name: 'Int Studio A', slug: 'int-studio-a' })
    studioB = await ensureTenant(payload, { name: 'Int Studio B', slug: 'int-studio-b' })
    await cleanup()
    hostA = await makeUser('host-a', studioA, ['event-organizer'])
    otherClientA = await makeUser('client-a', studioA, ['client'])
    hostB = await makeUser('host-b', studioB, ['event-organizer'])
    managerA = await makeUser('manager-a', studioA, ['production-manager'])
    wedding = await makeEvent(studioA, 'wedding', [hostA.id])
    gala = await makeEvent(studioA, 'gala', [otherClientA.id])
    dj = await makeVendor(studioA, 'DJ')
    florist = await makeVendor(studioA, 'Florist')
    caterer = await makeVendor(studioA, 'Caterer')
    booked = await book(wedding, dj, 'confirmed')
    proposed = await book(wedding, florist, 'proposed')
    galaBooking = await book(gala, caterer, 'booked')
    general = await payload.create({
      collection: 'ticket-types',
      data: { event: wedding.id, name: `${PREFIX}General`, capacity: 50, maxPerOrder: 5 } as never,
      overrideAccess: true,
    })
    for (const [quantity, status, checkedInCount] of [
      [2, 'confirmed', 1],
      [3, 'confirmed', 0],
      [4, 'cancelled', 0],
    ] as const) {
      await payload.create({
        collection: 'registrations',
        data: { ticketType: general.id, name: `${PREFIX}Buyer`, email: `${PREFIX}${quantity}@example.com`, quantity, status, checkedInCount } as never,
        overrideAccess: true,
      })
    }
  })

  afterAll(cleanup)

  it("shows the host their event's booked vendors without money, notes or links", async () => {
    const bookings = await readAs('event-vendors', hostA)
    // Proposed vendors and other events' vendors stay hidden.
    expect(ids(bookings)).toEqual([booked.id])
    const [booking] = bookings
    expect(booking).toMatchObject({ role: booked.role, status: 'confirmed', instructions: 'Use the side gate.' })
    for (const field of ['amountDue', 'amountPaid', 'currency', 'paymentDueDate', 'staffNotes', 'vendorNote', 'vendorToken', 'bookingEmailedAt']) {
      expect(booking).not.toHaveProperty(field)
    }

    // The directory shows only the vendors booked for their events, by name and category.
    const vendors = await readAs('vendors', hostA)
    expect(ids(vendors)).toEqual([dj.id])
    expect(vendors[0]).toMatchObject({ name: dj.name, category: 'music' })
    for (const field of ['contactName', 'email', 'phone', 'website', 'address', 'notes']) {
      expect(vendors[0]).not.toHaveProperty(field)
    }

    // Staff still see everything.
    const staffView = await readAs('event-vendors', managerA, { id: { equals: booked.id } })
    expect(staffView[0]).toMatchObject({ amountDue: 120000, staffNotes: 'Negotiated down from 1500' })
    expect((await readAs('vendors', managerA, { id: { equals: dj.id } }))[0]).toMatchObject({ phone: '+351 900 000 000' })
  })

  it("keeps other events' and other studios' vendors from a host", async () => {
    await expect(payload.findByID({ collection: 'event-vendors', id: proposed.id, user: hostA, overrideAccess: false })).rejects.toThrow()
    expect(ids(await readAs('event-vendors', otherClientA))).toEqual([galaBooking.id])
    expect(ids(await readAs('vendors', otherClientA))).toEqual([caterer.id])
    expect(await readAs('event-vendors', hostB)).toEqual([])
    expect(await readAs('vendors', hostB)).toEqual([])
    expect(await readAs('ticket-types', hostB)).toEqual([])
  })

  it('never lets a host change a booking, a vendor or a ticket, or send a vendor link', async () => {
    await expect(
      payload.update({ collection: 'event-vendors', id: booked.id, data: { arrivalAt: '2027-06-12T10:00:00.000Z' }, user: hostA, overrideAccess: false }),
    ).rejects.toThrow()
    await expect(payload.delete({ collection: 'event-vendors', id: booked.id, user: hostA, overrideAccess: false })).rejects.toThrow()
    await expect(
      payload.create({
        collection: 'event-vendors',
        data: { event: wedding.id, vendor: florist.id, role: 'Extra', status: 'booked' } as never,
        user: hostA,
        overrideAccess: false,
      }),
    ).rejects.toThrow()
    await expect(payload.update({ collection: 'vendors', id: dj.id, data: { name: 'Renamed' }, user: hostA, overrideAccess: false })).rejects.toThrow()
    await expect(
      payload.update({ collection: 'ticket-types', id: general.id, data: { capacity: 500 }, user: hostA, overrideAccess: false }),
    ).rejects.toThrow()

    const req = (await createLocalReq({ user: hostA }, payload)) as PayloadRequest
    req.user = { ...hostA, collection: 'users' } as PayloadRequest['user']
    req.json = async () => ({ booking: booked.id })
    const saved = { host: process.env.SMTP_HOST, from: process.env.EMAIL_FROM_ADDRESS }
    process.env.SMTP_HOST = '127.0.0.1'
    process.env.EMAIL_FROM_ADDRESS = 'studio@angelus.test'
    try {
      expect((await sendVendorLink(req)).status).toBe(404)
    } finally {
      if (saved.host) process.env.SMTP_HOST = saved.host
      else delete process.env.SMTP_HOST
      if (saved.from) process.env.EMAIL_FROM_ADDRESS = saved.from
      else delete process.env.EMAIL_FROM_ADDRESS
    }
  })

  it("shows the host their event's tickets and counts only confirmed places", async () => {
    expect(ids(await readAs('ticket-types', hostA))).toEqual([general.id])
    expect(await readAs('ticket-types', otherClientA)).toEqual([])
    // Buyers' names and addresses stay with the studio.
    const registrations = await payload
      .find({ collection: 'registrations', where: { ticketType: { equals: general.id } }, user: hostA, overrideAccess: false })
      .then((result) => result.docs)
      .catch(() => [])
    expect(registrations).toEqual([])
    expect((await eventTicketSales(payload, wedding.id)).get(String(general.id))).toEqual({ sold: 5, arrived: 1 })
  })
})
