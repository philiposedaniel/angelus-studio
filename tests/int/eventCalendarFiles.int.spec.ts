import { getPayload, type Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { invitationCalendar, publicEventCalendar, ticketCalendar, vendorCalendar } from '@/lib/eventCalendar'
import config from '@/payload.config'
import type { Event, Tenant, TicketType, Vendor } from '@/payload-types'

import { ensureTenant } from '../helpers/seedTenant'

/** Guests, ticket holders and vendors save the event to their calendar from their own private link. */

const PREFIX = 'int-icsfile-'

let payload: Payload
let studioA: Tenant
let studioB: Tenant
let event: Event
let vendor: Vendor
let general: TicketType

const unfolded = (body: string) => body.replace(/\r\n /g, '')

const cleanup = async () => {
  await payload.delete({ collection: 'events', where: { slug: { like: PREFIX } }, overrideAccess: true })
  await payload.delete({ collection: 'vendors', where: { name: { like: PREFIX } }, overrideAccess: true })
}

describe('calendar files behind private links', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    studioA = await ensureTenant(payload, { name: 'Int Calendar File A', slug: 'int-icsfile-a' })
    studioB = await ensureTenant(payload, { name: 'Int Calendar File B', slug: 'int-icsfile-b' })
    await cleanup()
    event = await payload.create({
      collection: 'events',
      data: {
        tenant: studioA.id,
        title: `${PREFIX}Summer Gala`,
        slug: `${PREFIX}gala`,
        startsAt: '2027-06-12T15:00:00.000Z',
        endsAt: '2027-06-12T23:00:00.000Z',
        timeZone: 'Europe/Lisbon',
        location: 'Quinta da Regaleira, Sintra',
        published: true,
      } as never,
      overrideAccess: true,
    })
    vendor = await payload.create({
      collection: 'vendors',
      data: { tenant: studioA.id, name: `${PREFIX}Band`, category: 'music', phone: '+351 900 000 000' } as never,
      overrideAccess: true,
    })
    general = await payload.create({
      collection: 'ticket-types',
      data: { event: event.id, name: `${PREFIX}General`, capacity: 50, maxPerOrder: 5 } as never,
      overrideAccess: true,
    })
  })

  afterAll(cleanup)

  it("gives a guest the event with a link back to their invitation, until they decline", async () => {
    const guest = await payload.create({
      collection: 'event-guests',
      data: { event: event.id, name: `${PREFIX}Maria`, partySize: 2, staffNotes: 'Seat away from the band' } as never,
      overrideAccess: true,
    })
    const token = guest.inviteToken as string
    const found = await invitationCalendar(payload, studioA.id, token, 'en')
    const body = unfolded(found!.body)
    expect(body).toContain('DTSTART:20270612T150000Z')
    expect(body).toContain('DTEND:20270612T230000Z')
    expect(body).toContain(`SUMMARY:${PREFIX}Summer Gala`)
    expect(body).toContain('LOCATION:Quinta da Regaleira\\, Sintra')
    expect(body).toContain(`/en/invite/${token}`)
    expect(body).toContain(`UID:invite-${guest.id}@`)
    expect(body).not.toContain('Seat away')
    expect(found!.filename).toBe(`invitation-${PREFIX}gala.ics`)

    // Another studio's site finds nothing with the same token.
    expect(await invitationCalendar(payload, studioB.id, token, 'en')).toBeNull()
    expect(await invitationCalendar(payload, studioA.id, 'not-a-token', 'en')).toBeNull()

    await payload.update({ collection: 'event-guests', id: guest.id, data: { rsvpStatus: 'declined' } as never, overrideAccess: true })
    expect(await invitationCalendar(payload, studioA.id, token, 'en')).toBeNull()
  })

  it('gives a confirmed ticket holder the event, and nothing for a pending or cancelled ticket', async () => {
    const make = (status: string) =>
      payload.create({
        collection: 'registrations',
        data: { ticketType: general.id, name: `${PREFIX}Buyer`, email: `${PREFIX}${status}@example.com`, quantity: 1, status } as never,
        overrideAccess: true,
      })
    const confirmed = await make('confirmed')
    const token = confirmed.ticketToken as string
    const body = unfolded((await ticketCalendar(payload, studioA.id, token, 'es'))!.body)
    expect(body).toContain('DTSTART:20270612T150000Z')
    expect(body).toContain(`/es/tickets/${token}`)
    expect(body).not.toContain(`${PREFIX}confirmed@example.com`)
    expect(await ticketCalendar(payload, studioB.id, token, 'es')).toBeNull()

    for (const status of ['pending', 'cancelled']) {
      const other = await make(status)
      expect(await ticketCalendar(payload, studioA.id, other.ticketToken, 'en')).toBeNull()
    }
  })

  it("gives a vendor their arrival time and role, never amounts or notes", async () => {
    const booking = await payload.create({
      collection: 'event-vendors',
      data: {
        event: event.id,
        vendor: vendor.id,
        role: 'Live band',
        status: 'booked',
        arrivalAt: '2027-06-12T12:30:00.000Z',
        currency: 'eur',
        amountDue: 250000,
        staffNotes: 'Negotiated down',
      } as never,
      overrideAccess: true,
    })
    const token = booking.vendorToken as string
    const body = unfolded((await vendorCalendar(payload, studioA.id, token, 'en'))!.body)
    expect(body).toContain('DTSTART:20270612T123000Z')
    expect(body).toContain('DTEND:20270612T230000Z')
    expect(body).toContain(`SUMMARY:${PREFIX}Summer Gala: Live band`)
    expect(body).toContain(`/en/vendor/${token}`)
    for (const hidden of ['2500', 'Negotiated', '+351']) expect(body).not.toContain(hidden)
    expect(await vendorCalendar(payload, studioB.id, token, 'en')).toBeNull()

    await payload.update({ collection: 'event-vendors', id: booking.id, data: { status: 'cancelled' }, overrideAccess: true })
    expect(await vendorCalendar(payload, studioA.id, token, 'en')).toBeNull()
  })

  it("gives anyone a published event from the studio's own site, and nothing from another studio's", async () => {
    const found = await publicEventCalendar(payload, studioA.id, event.slug, 'en')
    const body = unfolded(found!.body)
    expect(body).toContain('DTSTART:20270612T150000Z')
    expect(body).toContain(`UID:event-${event.id}@`)
    expect(body).toContain(`/en/events/${event.slug}`)
    expect(found!.filename).toBe(`${PREFIX}gala.ics`)
    expect(await publicEventCalendar(payload, studioB.id, event.slug, 'en')).toBeNull()
    expect(await publicEventCalendar(payload, studioA.id, 'no-such-event', 'en')).toBeNull()
  })

  it('stops giving files once the event is unpublished', async () => {
    const guest = await payload.create({
      collection: 'event-guests',
      data: { event: event.id, name: `${PREFIX}Late` } as never,
      overrideAccess: true,
    })
    await payload.update({ collection: 'events', id: event.id, data: { published: false }, overrideAccess: true })
    try {
      expect(await invitationCalendar(payload, studioA.id, guest.inviteToken, 'en')).toBeNull()
      expect(await publicEventCalendar(payload, studioA.id, event.slug, 'en')).toBeNull()
    } finally {
      await payload.update({ collection: 'events', id: event.id, data: { published: true }, overrideAccess: true })
    }
  })
})
