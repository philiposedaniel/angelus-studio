import type { Payload, PayloadHandler } from 'payload'

import { hasTenantRole, isSuperAdmin } from '@/access/roles'
import { emailConfigured, queueEmail } from '@/lib/email'
import { idOf } from '@/lib/ids'
import { isShareToken } from '@/lib/shareTokens'
import type { Event, EventVendor, Vendor } from '@/payload-types'

/** Staff who manage vendors and what the studio owes them. */
export const VENDOR_STAFF_ROLES = ['admin', 'production-manager'] as const

export const VENDOR_CATEGORIES = [
  'venue',
  'catering',
  'cake',
  'florist',
  'decor',
  'rentals',
  'music',
  'sound-and-lighting',
  'photography',
  'videography',
  'hair-and-makeup',
  'officiant',
  'transport',
  'planner',
  'security',
  'other',
] as const
export type VendorCategory = (typeof VENDOR_CATEGORIES)[number]

export const VENDOR_CATEGORY_LABELS: Record<VendorCategory, string> = {
  venue: 'Venue',
  catering: 'Catering',
  cake: 'Cake and desserts',
  florist: 'Florist',
  decor: 'Decor',
  rentals: 'Rentals',
  music: 'Music, band or DJ',
  'sound-and-lighting': 'Sound and lighting',
  photography: 'Photography',
  videography: 'Videography',
  'hair-and-makeup': 'Hair and makeup',
  officiant: 'Officiant',
  transport: 'Transport',
  planner: 'Planner',
  security: 'Security',
  other: 'Other',
}

/** Where a vendor's booking for one event stands. Vendors move it to confirmed from their link. */
export const BOOKING_STATUSES = ['proposed', 'booked', 'confirmed', 'cancelled'] as const
export type BookingStatus = (typeof BOOKING_STATUSES)[number]

export const BOOKING_STATUS_LABELS: Record<BookingStatus, string> = {
  proposed: 'Proposed',
  booked: 'Booked',
  confirmed: 'Confirmed by vendor',
  cancelled: 'Cancelled',
}

/** Totals per currency for an event's vendors, cancelled bookings left out. All in minor units. */
export function summarizeVendorCosts(
  bookings: readonly Pick<EventVendor, 'status' | 'amountDue' | 'amountPaid' | 'currency'>[],
) {
  const totals = new Map<string, { due: number; paid: number }>()
  let active = 0
  let confirmed = 0
  for (const booking of bookings) {
    if (booking.status === 'cancelled') continue
    active += 1
    if (booking.status === 'confirmed') confirmed += 1
    const currency = booking.currency ?? 'eur'
    const total = totals.get(currency) ?? { due: 0, paid: 0 }
    total.due += booking.amountDue ?? 0
    total.paid += booking.amountPaid ?? 0
    totals.set(currency, total)
  }
  return {
    active,
    confirmed,
    totals: [...totals].map(([currency, { due, paid }]) => ({ currency, due, paid, outstanding: due - paid })),
  }
}

/**
 * The booking behind a vendor link, on this studio's site. Vendors have no access to the API;
 * the token and the site's studio are the only keys. Cancelled bookings no longer open.
 */
export async function findVendorBooking(
  payload: Payload,
  tenantId: number,
  token: unknown,
): Promise<{ booking: EventVendor; vendor: Vendor; event: Event } | null> {
  if (!isShareToken(token)) return null
  const { docs } = await payload.find({
    collection: 'event-vendors',
    where: {
      and: [
        { tenant: { equals: tenantId } },
        { vendorToken: { equals: token } },
        { status: { not_equals: 'cancelled' } },
      ],
    },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })
  const booking = docs[0]
  const eventId = idOf(booking?.event)
  const vendorId = idOf(booking?.vendor)
  if (!booking || eventId === undefined || vendorId === undefined) return null
  const [event, vendor] = await Promise.all([
    payload.findByID({ collection: 'events', id: eventId, depth: 0, overrideAccess: true }).catch(() => null),
    payload.findByID({ collection: 'vendors', id: vendorId, depth: 0, overrideAccess: true }).catch(() => null),
  ])
  if (!event || !vendor || String(idOf(event.tenant)) !== String(tenantId)) return null
  return { booking, vendor, event }
}

/**
 * The day's arrivals for a vendor's page: each booked or confirmed vendor's role and arrival time on
 * the same event, in arrival order. Only the role and time leave the studio, never names, contacts,
 * amounts or notes, so vendors can coordinate without seeing each other's details.
 */
export async function eventArrivals(payload: Payload, booking: Pick<EventVendor, 'id' | 'event' | 'tenant'>) {
  const eventId = idOf(booking.event)
  const tenantId = idOf(booking.tenant)
  if (eventId === undefined || tenantId === undefined) return []
  const { docs } = await payload.find({
    collection: 'event-vendors',
    where: {
      and: [
        { tenant: { equals: tenantId } },
        { event: { equals: eventId } },
        { status: { in: ['booked', 'confirmed'] } },
      ],
    },
    sort: 'arrivalAt',
    pagination: false,
    depth: 0,
    overrideAccess: true,
    select: { role: true, arrivalAt: true },
  })
  return docs.map((doc) => ({
    role: doc.role,
    arrivalAt: doc.arrivalAt ?? null,
    you: String(doc.id) === String(booking.id),
  }))
}

export type ConfirmState = { status: 'idle' } | { status: 'confirmed' } | { status: 'error'; reason: 'failed' }

/** A vendor confirms their booking from their link, optionally with a note for the studio. */
export async function confirmVendorBooking({
  payload,
  tenantId,
  form,
  now = Date.now(),
}: {
  payload: Payload
  tenantId: number
  form: FormData
  now?: number
}): Promise<ConfirmState> {
  const found = await findVendorBooking(payload, tenantId, form.get('token'))
  if (!found) return { status: 'error', reason: 'failed' }
  const raw = form.get('vendorNote')
  const vendorNote = typeof raw === 'string' ? raw.trim().slice(0, 1000) : ''
  try {
    // System write: vendors have no update access; the link's token stands in for it.
    await payload.update({
      collection: 'event-vendors',
      id: found.booking.id,
      data: {
        status: 'confirmed',
        confirmedAt: new Date(now).toISOString(),
        ...(vendorNote ? { vendorNote } : {}),
      },
      overrideAccess: true,
    })
  } catch (error) {
    payload.logger.error({ err: error, msg: 'Could not confirm a vendor booking' })
    return { status: 'error', reason: 'failed' }
  }
  return { status: 'confirmed' }
}

/**
 * POST /api/event-vendors/send-link with JSON `{ booking }`: emails the vendor their link again,
 * for staff of the booking's studio. Not more than once a minute, so a double click sends one.
 */
export const sendVendorLink: PayloadHandler = async (req) => {
  const fail = (status: number, message: string) => Response.json({ errors: [{ message }] }, { status })
  if (!req.user) return fail(401, 'Sign in first.')
  if (!emailConfigured()) return fail(409, 'Email sending is not set up yet.')
  const body = (await req.json?.().catch(() => null)) as { booking?: unknown } | null | undefined
  const id = body?.booking
  if ((typeof id !== 'string' && typeof id !== 'number') || !/^\d+$/.test(String(id))) return fail(404, 'Booking not found.')
  const booking = await req.payload
    .findByID({ collection: 'event-vendors', id: String(id), depth: 0, req, user: req.user, overrideAccess: false })
    .catch(() => null)
  // Organizers can read their event's bookings, but only the studio's staff send links.
  if (!booking || !(isSuperAdmin(req.user) || hasTenantRole(req.user, idOf(booking.tenant) ?? '', VENDOR_STAFF_ROLES))) {
    return fail(404, 'Booking not found.')
  }
  if (booking.status === 'cancelled') return fail(409, 'This booking is cancelled.')
  const vendor = await req.payload
    .findByID({ collection: 'vendors', id: idOf(booking.vendor)!, depth: 0, req, user: req.user, overrideAccess: false })
    .catch(() => null)
  if (!vendor?.email) return fail(409, 'Add an email address to the vendor first.')
  await queueEmail(req, 'vendorBooking', booking.id)
  return Response.json({ queued: 1 })
}
