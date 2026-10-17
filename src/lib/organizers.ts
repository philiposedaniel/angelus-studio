import type { Payload, PayloadRequest } from 'payload'

import { hasTenantRole, isSuperAdmin, tenantIdOf, type TenantId } from '@/access/roles'
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
