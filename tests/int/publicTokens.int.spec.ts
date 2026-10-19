import { getPayload, type Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { findInvitation } from '@/lib/rsvp'
import { findVendorBooking } from '@/lib/vendors'
import config from '@/payload.config'
import type { Event, Tenant, Vendor } from '@/payload-types'

import { ensureTenant } from '../helpers/seedTenant'

// Private links on public pages (invitations, vendor bookings) are looked up by token alone, with the
// studio's own tenant as the second key. A token from another studio must find nothing.
const PREFIX = 'int-public-token-'

let payload: Payload
let studioA: Tenant
let studioB: Tenant
let eventA: Event
let vendorA: Vendor

const cleanup = async () => {
  await payload.delete({ collection: 'event-vendors', where: { role: { like: PREFIX } }, overrideAccess: true })
  await payload.delete({ collection: 'event-guests', where: { name: { like: PREFIX } }, overrideAccess: true })
  await payload.delete({ collection: 'events', where: { slug: { like: PREFIX } }, overrideAccess: true })
  await payload.delete({ collection: 'vendors', where: { name: { like: PREFIX } }, overrideAccess: true })
}

describe('private links on public pages stay within their studio', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    studioA = await ensureTenant(payload, { name: 'Int Public Token A', slug: 'int-public-token-a' })
    studioB = await ensureTenant(payload, { name: 'Int Public Token B', slug: 'int-public-token-b' })
    await cleanup()
    eventA = await payload.create({
      collection: 'events',
      data: {
        tenant: studioA.id,
        title: `${PREFIX}Gala`,
        slug: `${PREFIX}gala`,
        startsAt: '2027-06-12T15:00:00.000Z',
        timeZone: 'Europe/Lisbon',
        published: true,
      } as never,
      overrideAccess: true,
    })
    vendorA = await payload.create({
      collection: 'vendors',
      data: { tenant: studioA.id, name: `${PREFIX}Band`, category: 'music' } as never,
      overrideAccess: true,
    })
  })

  afterAll(cleanup)

  it('finds an invitation with its own studio, and nothing with another studio’s tenant', async () => {
    const guest = await payload.create({
      collection: 'event-guests',
      data: { event: eventA.id, name: `${PREFIX}Maria`, partySize: 2 } as never,
      overrideAccess: true,
    })
    const token = guest.inviteToken as string

    expect((await findInvitation(payload, studioA.id, token))?.guest.id).toBe(guest.id)
    expect(await findInvitation(payload, studioB.id, token)).toBeNull()
    expect(await findInvitation(payload, studioA.id, 'not-a-real-token')).toBeNull()
  })

  it('finds a vendor booking with its own studio, and nothing with another studio’s tenant', async () => {
    const booking = await payload.create({
      collection: 'event-vendors',
      data: { event: eventA.id, vendor: vendorA.id, role: `${PREFIX}DJ`, currency: 'eur' } as never,
      overrideAccess: true,
    })
    const token = booking.vendorToken as string

    expect((await findVendorBooking(payload, studioA.id, token))?.booking.id).toBe(booking.id)
    expect(await findVendorBooking(payload, studioB.id, token)).toBeNull()
  })

  it('finds no vendor booking once it is cancelled, even with its own studio', async () => {
    const booking = await payload.create({
      collection: 'event-vendors',
      data: { event: eventA.id, vendor: vendorA.id, role: `${PREFIX}Lights`, currency: 'eur', status: 'cancelled' } as never,
      overrideAccess: true,
    })
    expect(await findVendorBooking(payload, studioA.id, booking.vendorToken as string)).toBeNull()
  })
})
