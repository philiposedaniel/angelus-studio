/**
 * Role definitions shared by every module. Authorization is deny-by-default:
 * a user only gets access that a rule below explicitly grants.
 */
export const STAFF_ROLES = [
  'super-admin',
  'admin',
  'production-manager',
  'photographer',
  'videographer',
  'editor',
  'finance-manager',
] as const

export const ROLES = [...STAFF_ROLES, 'event-organizer', 'client'] as const

export type Role = (typeof ROLES)[number]

export const ROLE_LABELS: Record<Role, string> = {
  'super-admin': 'Super Administrator',
  admin: 'Administrator',
  'production-manager': 'Production Manager',
  photographer: 'Photographer',
  videographer: 'Videographer',
  editor: 'Editor',
  'finance-manager': 'Finance Manager',
  'event-organizer': 'Event Organizer',
  client: 'Client',
}

export const DEFAULT_ROLE: Role = 'client'

/** Minimal shape of an authenticated user that the helpers need. */
export type RoleHolder = { roles?: readonly string[] | null } | null | undefined

export function hasAnyRole(user: RoleHolder, roles: readonly Role[]): boolean {
  if (!user?.roles?.length) return false
  return user.roles.some((role) => (roles as readonly string[]).includes(role))
}

export const isSuperAdmin = (user: RoleHolder): boolean => hasAnyRole(user, ['super-admin'])

export const isAdmin = (user: RoleHolder): boolean => hasAnyRole(user, ['super-admin', 'admin'])

export const isStaff = (user: RoleHolder): boolean => hasAnyRole(user, STAFF_ROLES)

/**
 * Decides whether `actor` may set a user's roles from `previous` to `next`.
 * Only administrators change roles, and only a super administrator can grant
 * or remove the super administrator role.
 */
export function canChangeRoles(
  actor: RoleHolder,
  previous: readonly string[],
  next: readonly string[],
): boolean {
  const unchanged =
    previous.length === next.length && previous.every((role) => next.includes(role))
  if (unchanged) return true
  if (!isAdmin(actor)) return false
  const touchesSuperAdmin = previous.includes('super-admin') !== next.includes('super-admin')
  return !touchesSuperAdmin || isSuperAdmin(actor)
}
