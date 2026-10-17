import { getPayload, type Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { idOf } from '@/lib/ids'
import { confirmVendorBooking } from '@/lib/vendors'
import config from '@/payload.config'
import type { Event, Tenant, User, Vendor } from '@/payload-types'

import { ensureTenant } from '../helpers/seedTenant'

const PREFIX = 'int-vendor-'
const password = 'int-Password-1'

let payload: Payload
let studioA: Tenant
let studioB: Tenant
let managerA: User
let managerB: User
let editorA: User
let eventA: Event
let eventB: Event
let djA: Vendor
let floristB: Vendor

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

const makeVendor = (tenant: Tenant, name: string) =>
  payload.create({
    collection: 'vendors',
    data: { tenant: tenant.id, name: `${PREFIX}${name}`, category: 'music' } as never,
    overrideAccess: true,
  })

const book = (event: Event, vendor: Vendor, overrides: Record<string, unknown> = {}) =>
  payload.create({
    collection: 'event-vendors',
    data: { event: event.id, vendor: vendor.id, role: `${PREFIX}DJ`, currency: 'eur', ...overrides } as never,
    overrideAccess: true,
  })

const form = (values: Record<string, string>) => {
  const data = new FormData()
  for (const [key, value] of Object.entries(values)) data.set(key, value)
  return data
}

const visible = (collection: 'vendors' | 'event-vendors', id: number, user?: User) =>
  payload
    .find({ collection, where: { id: { equals: id } }, user, overrideAccess: false })
    .then((r) => r.docs.length)
    .catch(() => 0)

const cleanup = async () => {
  await payload.delete({ collection: 'event-vendors', where: { role: { like: PREFIX } }, overrideAccess: true })
  await payload.delete({ collection: 'events', where: { slug: { like: PREFIX } }, overrideAccess: true })
  await payload.delete({ collection: 'vendors', where: { name: { like: PREFIX } }, overrideAccess: true })
  await payload.delete({ collection: 'users', where: { email: { like: PREFIX } } })
}

describe('vendors and event bookings', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    studioA = await ensureTenant(payload, { name: 'Int Studio A', slug: 'int-studio-a' })
    studioB = await ensureTenant(payload, { name: 'Int Studio B', slug: 'int-studio-b' })
    await cleanup()
    managerA = await makeUser('manager-a', studioA, ['production-manager'])
    managerB = await makeUser('manager-b', studioB, ['production-manager'])
    editorA = await makeUser('editor-a', studioA, ['editor'])
    eventA = await makeEvent(studioA, 'wedding-a')
    eventB = await makeEvent(studioB, 'wedding-b')
    djA = await makeVendor(studioA, 'DJ Sol')
    floristB = await makeVendor(studioB, 'Flores')
  })

  afterAll(cleanup)

  it('keeps vendors and bookings to their own studio\'s admins and production managers', async () => {
    const booking = await book(eventA, djA, { amountDue: 120000 })
    expect(await visible('vendors', djA.id, managerA)).toBe(1)
    expect(await visible('event-vendors', booking.id, managerA)).toBe(1)
    for (const user of [managerB, editorA, undefined]) {
      expect(await visible('vendors', djA.id, user)).toBe(0)
      expect(await visible('event-vendors', booking.id, user)).toBe(0)
    }
    await expect(
      payload.update({ collection: 'event-vendors', id: booking.id, data: { amountPaid: 1 }, user: managerB, overrideAccess: false }),
    ).rejects.toThrow()
  })

  it('refuses a vendor from another studio, and a booking on another studio\'s event', async () => {
    await expect(book(eventA, floristB)).rejects.toThrow(/this studio's vendors/)
    await expect(
      payload.create({
        collection: 'event-vendors',
        data: { event: eventB.id, vendor: floristB.id, role: `${PREFIX}x`, tenant: studioB.id } as never,
        user: managerA,
        overrideAccess: false,
      }),
    ).rejects.toThrow()
  })

  it('puts a booking in its event\'s studio and gives it its own link', async () => {
    const booking = await book(eventA, djA, { tenant: studioB.id, vendorToken: 'attacker-chosen' })
    expect(idOf(booking.tenant)).toBe(studioA.id)
    expect(booking.vendorToken).toMatch(/^[A-Za-z0-9_-]{32}$/)
  })

  it('refuses amounts that are not whole minor units', async () => {
    await expect(book(eventA, djA, { amountDue: 12.5 })).rejects.toThrow()
    await expect(book(eventA, djA, { amountPaid: -100 })).rejects.toThrow()
  })

  it('lets the vendor confirm from their link, only on their studio\'s site', async () => {
    const booking = await book(eventA, djA, { status: 'booked' })
    const token = booking.vendorToken!
    expect(await confirmVendorBooking({ payload, tenantId: studioB.id, form: form({ token }) })).toEqual({
      status: 'error',
      reason: 'failed',
    })
    const now = Date.parse('2026-11-01T12:00:00Z')
    expect(
      await confirmVendorBooking({ payload, tenantId: studioA.id, form: form({ token, vendorNote: 'Need two sockets' }), now }),
    ).toEqual({ status: 'confirmed' })
    const saved = await payload.findByID({ collection: 'event-vendors', id: booking.id, overrideAccess: true })
    expect(saved).toMatchObject({ status: 'confirmed', vendorNote: 'Need two sockets' })
    expect(saved.confirmedAt).toBe(new Date(now).toISOString())
  })

  it('stops a cancelled booking\'s link working', async () => {
    const booking = await book(eventA, djA, { status: 'cancelled' })
    expect(await confirmVendorBooking({ payload, tenantId: studioA.id, form: form({ token: booking.vendorToken! }) })).toEqual({
      status: 'error',
      reason: 'failed',
    })
  })

  it('keeps a booked vendor from being deleted, and removes bookings with their event', async () => {
    const event = await makeEvent(studioA, 'short-lived')
    const vendor = await makeVendor(studioA, 'Booked')
    const booking = await book(event, vendor)
    await expect(payload.delete({ collection: 'vendors', id: vendor.id, overrideAccess: true })).rejects.toThrow(/booked/)
    await payload.delete({ collection: 'events', id: event.id, overrideAccess: true })
    expect(await payload.count({ collection: 'event-vendors', where: { id: { equals: booking.id } } })).toMatchObject({
      totalDocs: 0,
    })
    await payload.delete({ collection: 'vendors', id: vendor.id, overrideAccess: true })
  })
})
