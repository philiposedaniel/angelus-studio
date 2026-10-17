import type { PayloadHandler } from 'payload'

import { DEFAULT_LOCALE } from '@/i18n/config'
import { csvCell, csvFile } from '@/lib/guestCsv'
import { idOf } from '@/lib/ids'
import { tenantLocales } from '@/lib/locale'
import { siteOrigin } from '@/lib/siteOrigin'
import { holdsPlaces } from '@/lib/tickets'
import type { Registration } from '@/payload-types'

const fail = (status: number, message: string) => Response.json({ errors: [{ message }] }, { status })

/** What a registration's status means for the door, in words staff use. */
export function attendeeStatus(registration: Pick<Registration, 'status' | 'holdExpiresAt'>, now = Date.now()) {
  if (registration.status === 'confirmed') return 'Confirmed'
  if (registration.status === 'cancelled') return 'Cancelled'
  return holdsPlaces({ status: registration.status, holdExpiresAt: registration.holdExpiresAt ?? null }, now)
    ? 'Waiting for payment'
    : 'Not paid'
}

/** Everyone registered for an event as CSV: ticket, places, payment, promo code, check-in and ticket link. */
export function attendeesToCsv(
  registrations: readonly Registration[],
  ticketName: (registration: Registration) => string,
  ticketUrl: (registration: Registration) => string,
  promoCode: (registration: Registration) => string = () => '',
  now = Date.now(),
) {
  const header = [
    'Name',
    'Email',
    'Phone',
    'Ticket',
    'Places',
    'Status',
    'Amount',
    'Currency',
    'Promo code',
    'Language',
    'Registered at',
    'Checked in',
    'Checked in at',
    'Ticket link',
  ]
  const lines = registrations.map((registration) =>
    [
      registration.name,
      registration.email,
      registration.phone,
      ticketName(registration),
      registration.quantity ?? 1,
      attendeeStatus(registration, now),
      // Stored in minor units; every currency offered has two decimals.
      ((registration.amount ?? 0) / 100).toFixed(2),
      (registration.currency ?? '').toUpperCase(),
      promoCode(registration),
      registration.language,
      registration.createdAt,
      registration.checkedInCount ?? 0,
      registration.checkedInAt,
      registration.ticketToken ? ticketUrl(registration) : '',
    ]
      .map(csvCell)
      .join(','),
  )
  return csvFile(header, lines)
}

/**
 * GET /api/registrations/export?event=<id>: the event's attendee list as a CSV file. The event
 * and its registrations are read as the signed-in user, so the collections' own access rules
 * decide: only the studio's admins and production managers get it.
 */
export const exportAttendees: PayloadHandler = async (req) => {
  if (!req.user) return fail(401, 'Sign in first.')
  const eventId = req.searchParams.get('event')
  if (!eventId || !/^\d+$/.test(eventId)) return fail(404, 'Event not found.')
  const access = { req, user: req.user, overrideAccess: false } as const
  const event = await req.payload.findByID({ collection: 'events', id: eventId, depth: 0, ...access }).catch(() => null)
  if (!event) return fail(404, 'Event not found.')
  const [registrations, ticketTypes, promoCodes] = await Promise.all([
    req.payload
      .find({ collection: 'registrations', where: { event: { equals: event.id } }, sort: 'name', pagination: false, depth: 0, ...access })
      .catch(() => null),
    req.payload
      .find({
        collection: 'ticket-types',
        where: { event: { equals: event.id } },
        pagination: false,
        depth: 0,
        select: { name: true },
        ...access,
      })
      .catch(() => null),
    req.payload
      .find({
        collection: 'promo-codes',
        where: { event: { equals: event.id } },
        pagination: false,
        depth: 0,
        select: { code: true },
        ...access,
      })
      .catch(() => null),
  ])
  if (!registrations || !ticketTypes) {
    return fail(403, 'Only studio admins and production managers can download the attendee list.')
  }

  const origin = await siteOrigin(req.payload, event.tenant)
  const tenant = await req.payload.findByID({ collection: 'tenants', id: idOf(event.tenant)!, depth: 0 }).catch(() => null)
  const offered = tenant ? tenantLocales(tenant) : [DEFAULT_LOCALE]
  const names = new Map(ticketTypes.docs.map((ticketType) => [String(ticketType.id), ticketType.name]))
  const codes = new Map((promoCodes?.docs ?? []).map((promo) => [String(promo.id), promo.code]))
  const csv = attendeesToCsv(
    registrations.docs,
    (registration) => names.get(String(idOf(registration.ticketType))) ?? '',
    (registration) => {
      const language = registration.language && offered.includes(registration.language) ? registration.language : offered[0]
      return `${origin}/${language}/tickets/${registration.ticketToken}`
    },
    (registration) => codes.get(String(idOf(registration.promoCode))) ?? '',
  )
  const name = `attendees-${event.slug || event.id}.csv`.replace(/[^\w.-]/g, '_')
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${name}"`,
      'Cache-Control': 'private, no-store',
    },
  })
}
