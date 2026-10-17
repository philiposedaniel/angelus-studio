import type { Payload } from 'payload'

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
