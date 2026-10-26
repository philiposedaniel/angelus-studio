import { getPayload, type Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import config from '@/payload.config'
import type { Event, Tenant } from '@/payload-types'

import { ensureTenant } from '../helpers/seedTenant'

/**
 * A moved event sends its day-before reminders again for the new date. Reminders already sent for the
 * old date are cleared; other edits leave them alone.
 */

const PREFIX = 'int-event-moved-'
const HOUR = 3_600_000
let payload: Payload
let studio: Tenant
let counter = 0

const makeEvent = async (): Promise<Event> => {
  counter += 1
  return payload.create({
    collection: 'events',
    data: {
      tenant: studio.id,
      title: `${PREFIX}event ${counter}`,
      slug: `${PREFIX}event-${counter}`,
      startsAt: new Date(Date.now() + 20 * HOUR).toISOString(),
      timeZone: 'Europe/Lisbon',
      published: true,
    } as never,
    overrideAccess: true,
  })
}

const cleanup = async () => {
  await payload.delete({ collection: 'events', where: { slug: { like: PREFIX } }, overrideAccess: true })
}

describe('moving an event', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    studio = await ensureTenant(payload, { name: 'Int Event Moved', slug: 'int-event-moved' })
    await cleanup()
  }, 60_000)

  afterAll(cleanup)

  it('clears the day-before reminders already sent for guests and tickets', async () => {
    const event = await makeEvent()
    const guest = await payload.create({
      collection: 'event-guests',
      data: { event: event.id, name: 'Guest', email: `${PREFIX}guest-${counter}@example.com`, partySize: 1, language: 'en', rsvpStatus: 'attending', attendingCount: 1 } as never,
      overrideAccess: true,
    })
    const ticketType = await payload.create({
      collection: 'ticket-types',
      data: { event: event.id, name: `${PREFIX}Seat`, capacity: 20, maxPerOrder: 4, price: 0, currency: 'eur' } as never,
      overrideAccess: true,
    })
    const ticket = await payload.create({
      collection: 'registrations',
      data: { ticketType: ticketType.id, name: 'Ticket', email: `${PREFIX}ticket-${counter}@example.com`, quantity: 1, language: 'en' } as never,
      overrideAccess: true,
    })
    const sentAt = new Date().toISOString()
    await payload.update({ collection: 'event-guests', id: guest.id, data: { dayBeforeSentAt: sentAt }, overrideAccess: true })
    await payload.update({ collection: 'registrations', id: ticket.id, data: { dayBeforeSentAt: sentAt }, overrideAccess: true })

    await payload.update({
      collection: 'events',
      id: event.id,
      data: { startsAt: new Date(Date.now() + 26 * HOUR).toISOString() },
      overrideAccess: true,
    })

    expect((await payload.findByID({ collection: 'event-guests', id: guest.id, overrideAccess: true })).dayBeforeSentAt).toBeFalsy()
    expect((await payload.findByID({ collection: 'registrations', id: ticket.id, overrideAccess: true })).dayBeforeSentAt).toBeFalsy()
  })

  it('leaves the reminders alone when the event keeps its start time', async () => {
    const event = await makeEvent()
    const guest = await payload.create({
      collection: 'event-guests',
      data: { event: event.id, name: 'Steady', email: `${PREFIX}steady-${counter}@example.com`, partySize: 1, language: 'en', rsvpStatus: 'attending', attendingCount: 1 } as never,
      overrideAccess: true,
    })
    const sentAt = new Date().toISOString()
    await payload.update({ collection: 'event-guests', id: guest.id, data: { dayBeforeSentAt: sentAt }, overrideAccess: true })

    await payload.update({ collection: 'events', id: event.id, data: { title: `${PREFIX}renamed ${counter}` }, overrideAccess: true })

    expect((await payload.findByID({ collection: 'event-guests', id: guest.id, overrideAccess: true })).dayBeforeSentAt).toBeTruthy()
  })
})
