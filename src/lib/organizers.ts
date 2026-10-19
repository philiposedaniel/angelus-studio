import type { Access, FieldAccess, Payload, PayloadRequest, Where } from 'payload'

import { hasTenantRole, isSuperAdmin, tenantIdOf, tenantIdsWithRole, type TenantId, type TenantRole } from '@/access/roles'
import { idOf } from '@/lib/ids'
import type { Event, User } from '@/payload-types'

type Actor = User | null | undefined

/** Staff who manage every guest list of their studio. Guest details are personal data. */
export const GUEST_LIST_STAFF_ROLES = ['admin', 'production-manager'] as const

const isMemberOf = (user: Actor, tenantId: unknown) =>
  Boolean(user?.tenants?.some((membership) => String(tenantIdOf(membership)) === String(tenantId)))

/**
 * The events this user organizes: the studio lists them as an organizer on the event, and they
 * are still a member of that event's studio. Organizers manage those events' guest lists.
 */
export async function organizedEventIds(payload: Payload, user: Actor, req?: PayloadRequest): Promise<number[]> {
  if (!user) return []
  const { docs } = await payload.find({
    collection: 'events',
    where: { organizers: { in: [user.id] } },
    pagination: false,
    depth: 0,
    select: { tenant: true },
    overrideAccess: true,
    ...(req ? { req } : {}),
  })
  return docs.filter((event) => isMemberOf(user, idOf(event.tenant))).map((event) => event.id)
}

export const isOrganizerOf = (user: Actor, event: Pick<Event, 'organizers' | 'tenant'>) =>
  Boolean(user) &&
  isMemberOf(user, idOf(event.tenant)) &&
  (event.organizers ?? []).some((organizer) => String(idOf(organizer)) === String(user!.id))

/** Studio staff who manage every guest list of the studio. */
export const isGuestListStaff = (user: Actor, tenantId: TenantId | undefined | null) =>
  isSuperAdmin(user) ||
  (tenantId !== undefined && tenantId !== null && hasTenantRole(user, tenantId, GUEST_LIST_STAFF_ROLES))

/** Bookings an event's organizers can see: the vendors actually coming, not ones proposed or cancelled. */
export const ORGANIZER_VENDOR_STATUSES = ['booked', 'confirmed'] as const

/**
 * Read access for studio staff with `roles`, plus the organizers of an event for the records of
 * that event (`eventField`), optionally narrowed further by `organizerWhere`.
 */
export const staffOrEventOrganizers =
  (roles: readonly TenantRole[], { eventField = 'event', organizerWhere }: { eventField?: string; organizerWhere?: Where } = {}): Access =>
  async ({ req }) => {
    const { user } = req
    if (!user) return false
    if (isSuperAdmin(user)) return true
    const staffOf = tenantIdsWithRole(user, roles)
    const organized = await organizedEventIds(req.payload, user, req)
    const allowed: Where[] = [
      ...(staffOf.length > 0 ? [{ tenant: { in: staffOf } }] : []),
      ...(organized.length > 0
        ? [organizerWhere ? { and: [{ [eventField]: { in: organized } }, organizerWhere] } : { [eventField]: { in: organized } }]
        : []),
    ]
    if (allowed.length === 0) return false
    return allowed.length === 1 ? allowed[0]! : { or: allowed }
  }

/**
 * Read access to the studio's vendor directory for staff with `roles`, and for organizers only
 * the vendors booked (or confirmed) for the events they organize.
 */
export const staffOrOrganizersVendors =
  (roles: readonly TenantRole[]): Access =>
  async ({ req }) => {
    const { user } = req
    if (!user) return false
    if (isSuperAdmin(user)) return true
    const staffOf = tenantIdsWithRole(user, roles)
    const organized = await organizedEventIds(req.payload, user, req)
    const vendorIds =
      organized.length > 0
        ? (
            await req.payload.find({
              collection: 'event-vendors',
              where: { and: [{ event: { in: organized } }, { status: { in: [...ORGANIZER_VENDOR_STATUSES] } }] },
              pagination: false,
              depth: 0,
              select: { vendor: true },
              overrideAccess: true,
              req,
            })
          ).docs.map((booking) => idOf(booking.vendor))
        : []
    const allowed: Where[] = [
      ...(staffOf.length > 0 ? [{ tenant: { in: staffOf } }] : []),
      ...(vendorIds.length > 0 ? [{ id: { in: [...new Set(vendorIds)] } }] : []),
    ]
    if (allowed.length === 0) return false
    return allowed.length === 1 ? allowed[0]! : { or: allowed }
  }

/** A field only staff with `roles` in the document's studio may read; organizers never see it. */
export const staffOnlyField =
  (roles: readonly TenantRole[]): FieldAccess =>
  ({ req: { user }, doc, data }) => {
    if (isSuperAdmin(user)) return true
    const tenantId = idOf(doc?.tenant ?? data?.tenant)
    // A read that selected fields without the studio: the collection's access already limited
    // the rows to the user's studios and organized events, so staff anywhere is enough.
    if (tenantId === undefined || tenantId === null) return tenantIdsWithRole(user, roles).length > 0
    return hasTenantRole(user, tenantId, roles)
  }
