import type { Access, FieldAccess, Where } from 'payload'

import { isSuperAdmin, isStaffAnywhere, tenantIdsWithRole, type TenantRole } from './roles'

export * from './roles'

export const anyone: Access = () => true

export const superAdminsOnly: Access = ({ req: { user } }) => isSuperAdmin(user)

export const superAdminsOnlyField: FieldAccess = ({ req: { user } }) => isSuperAdmin(user)

export const staffAnywhere: Access = ({ req: { user } }) => isStaffAnywhere(user)

/**
 * Grants access to documents of the studios where the user holds one of `roles`.
 * The multi-tenant plugin also limits every query to the user's own studios; this adds
 * the role requirement on top. Super admins see everything.
 */
export const tenantRoles =
  (roles: readonly TenantRole[], tenantField = 'tenant'): Access =>
  ({ req: { user } }) => {
    if (isSuperAdmin(user)) return true
    const ids = tenantIdsWithRole(user, roles)
    if (ids.length === 0) return false
    return { [tenantField]: { in: ids } } satisfies Where
  }

export const tenantAdmins = tenantRoles(['admin'])

/** Staff roles that may manage public website content for their studio. */
export const tenantContentEditors = tenantRoles(['admin', 'production-manager', 'editor'])

/** The public sees published documents; studio staff also see their drafts. */
export const publishedOrTenantStaff: Access = ({ req: { user } }) => {
  if (isSuperAdmin(user)) return true
  const ids = tenantIdsWithRole(user, ['admin', 'production-manager', 'editor'])
  const published: Where = { published: { equals: true } }
  if (ids.length === 0) return published
  return { or: [published, { tenant: { in: ids } }] }
}
