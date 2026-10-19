import { hasTenantRole, isSuperAdmin, TENANT_STAFF_ROLES, type Actor, type TenantId } from '@/access/roles'

/**
 * The portal's calendar and sign-in security links are for studio staff of this studio (and platform
 * super admins). Clients and event organizers do not see the links. The pages still check access themselves.
 */
export const showStaffPortalLinks = (user: Actor, tenantId: TenantId): boolean =>
  isSuperAdmin(user) || hasTenantRole(user, tenantId, TENANT_STAFF_ROLES)
