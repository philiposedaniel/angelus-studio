import type { Access, Where } from 'payload'

import { isSuperAdmin, tenantIdsWithRole, type Actor, type TenantRole } from './roles'

/** Studio roles that create, upload to and manage client galleries. */
export const GALLERY_STAFF_ROLES: readonly TenantRole[] = [
  'admin',
  'production-manager',
  'photographer',
  'videographer',
  'editor',
]

/**
 * Conditions under which a client may see a gallery: they are assigned to it, it is
 * published, and it has not expired. `prefix` points at the gallery from another
 * collection (e.g. `gallery.` from gallery photos).
 */
export const clientGalleryWhere = (userId: number | string, prefix = ''): Where => ({
  and: [
    { [`${prefix}clients`]: { in: [userId] } },
    { [`${prefix}status`]: { equals: 'published' } },
    {
      or: [
        { [`${prefix}expiresAt`]: { exists: false } },
        { [`${prefix}expiresAt`]: { greater_than: new Date().toISOString() } },
      ],
    },
  ],
})

export const isGalleryStaffFor = (user: Actor, tenantId: number | string | null | undefined) =>
  isSuperAdmin(user) ||
  (tenantId !== null &&
    tenantId !== undefined &&
    tenantIdsWithRole(user, GALLERY_STAFF_ROLES).some((id) => String(id) === String(tenantId)))

/** Gallery staff see their studio's galleries; clients see galleries assigned to them. */
export const galleryRead =
  (prefix = ''): Access =>
  ({ req: { user } }) => {
    if (!user) return false
    if (isSuperAdmin(user)) return true
    const staffTenants = tenantIdsWithRole(user, GALLERY_STAFF_ROLES)
    const asClient = clientGalleryWhere(user.id, prefix)
    if (staffTenants.length === 0) return asClient
    return { or: [{ tenant: { in: staffTenants } }, asClient] }
  }

export const galleryStaff: Access = ({ req: { user } }) => {
  if (isSuperAdmin(user)) return true
  const ids = tenantIdsWithRole(user, GALLERY_STAFF_ROLES)
  return ids.length > 0 ? { tenant: { in: ids } } : false
}
