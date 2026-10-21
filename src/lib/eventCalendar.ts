import type { Payload } from 'payload'

import type { Locale } from '@/i18n/config'
import { getDictionary } from '@/i18n/dictionaries'
import { buildOccasionCalendar, type CalendarOccasion } from '@/lib/ics'
import { findInvitation } from '@/lib/rsvp'
import { siteOrigin } from '@/lib/siteOrigin'
import { findTicket } from '@/lib/tickets'
import { findVendorBooking } from '@/lib/vendors'
import type { Event } from '@/payload-types'

/**
 * Calendar files behind the private links guests, ticket holders and vendors already have. Each
 * one is found by its link's token on this studio's site only, and holds the event's title, time
 * and place and the link back, never other guests, amounts or staff notes.
 */

type Found = { body: string; filename: string }

const eventInLocale = (payload: Payload, event: Event, locale: Locale) =>
  payload.findByID({ collection: 'events', id: event.id, depth: 0, locale, overrideAccess: true })

const file = (origin: string, occasion: CalendarOccasion, filename: string): Found => ({
  body: buildOccasionCalendar({ occasion, host: origin.replace(/^https?:\/\//, '') || 'angelus-studio.invalid' }),
  filename,
})

/** A guest's invitation, while they have not declined it. */
export async function invitationCalendar(payload: Payload, tenantId: number, token: unknown, locale: Locale) {
  const found = await findInvitation(payload, tenantId, token)
  if (!found || found.guest.rsvpStatus === 'declined') return null
  const event = await eventInLocale(payload, found.event, locale)
  const origin = await siteOrigin(payload, tenantId)
  const url = `${origin}/${locale}/invite/${String(token)}`
  return file(
    origin,
    {
      uid: `invite-${found.guest.id}`,
      title: event.title,
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      location: event.location,
      description: getDictionary(locale).invite.calendarNote.replace('{url}', url),
      url,
    },
    `invitation-${event.slug}.ics`,
  )
}

/** A confirmed ticket. Pending and cancelled ones have no calendar file. */
export async function ticketCalendar(payload: Payload, tenantId: number, token: unknown, locale: Locale) {
  const found = await findTicket(payload, tenantId, token, locale)
  if (!found || found.registration.status !== 'confirmed') return null
  const { event } = found
  const origin = await siteOrigin(payload, tenantId)
  const url = `${origin}/${locale}/tickets/${String(token)}`
  return file(
    origin,
    {
      uid: `ticket-${found.registration.id}`,
      title: event.title,
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      location: event.location,
      description: getDictionary(locale).tickets.calendarNote.replace('{url}', url),
      url,
    },
    `ticket-${event.slug}.ics`,
  )
}

/** A vendor's booking, from their arrival time when the studio set one, else from the event's start. */
export async function vendorCalendar(payload: Payload, tenantId: number, token: unknown, locale: Locale) {
  const found = await findVendorBooking(payload, tenantId, token)
  if (!found) return null
  const event = await eventInLocale(payload, found.event, locale)
  const t = getDictionary(locale).vendorBooking
  const origin = await siteOrigin(payload, tenantId)
  const url = `${origin}/${locale}/vendor/${String(token)}`
  return file(
    origin,
    {
      uid: `vendor-booking-${found.booking.id}`,
      title: t.calendarTitle.replace('{event}', event.title).replace('{role}', found.booking.role),
      startsAt: found.booking.arrivalAt ?? event.startsAt,
      endsAt: event.endsAt,
      location: event.location,
      description: t.calendarNote.replace('{url}', url),
      url,
    },
    `booking-${event.slug}.ics`,
  )
}

/** A published event from the studio's public events page. Anyone can download it, as anyone can read the page. */
export async function publicEventCalendar(payload: Payload, tenantId: number, slug: string, locale: Locale) {
  const { docs } = await payload.find({
    collection: 'events',
    // Public read: the same access rules as the event page, so unpublished events stay hidden.
    overrideAccess: false,
    where: { and: [{ published: { equals: true } }, { tenant: { equals: tenantId } }, { slug: { equals: slug } }] },
    limit: 1,
    depth: 0,
    locale,
  })
  const event = docs[0]
  if (!event) return null
  const origin = await siteOrigin(payload, tenantId)
  const url = `${origin}/${locale}/events/${event.slug}`
  return file(
    origin,
    {
      uid: `event-${event.id}`,
      title: event.title,
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      location: event.location,
      description: [event.summary, url].filter(Boolean).join('\n\n'),
      url,
    },
    `${event.slug}.ics`,
  )
}

/** The response every calendar route sends: a download that is never cached or indexed. */
export const calendarResponse = (found: Found | null) =>
  found
    ? new Response(found.body, {
        headers: {
          'Content-Type': 'text/calendar; charset=utf-8',
          'Content-Disposition': `attachment; filename="${found.filename.replace(/[^\w.-]/g, '-')}"`,
          'Cache-Control': 'private, no-store',
          'Referrer-Policy': 'no-referrer',
          'X-Robots-Tag': 'noindex',
        },
      })
    : new Response('Not found', { status: 404 })
