/**
 * Roles and membership rules shared by every module. Authorization is
 * deny-by-default: a user only gets access that a rule below explicitly grants.
 *
 * Two levels:
 * - Platform role on the user (`roles`): `super-admin` operates the whole platform
 *   across every studio (tenant); everyone else is a plain `user`.
 * - Tenant roles on each membership (`tenants[].roles`): what the user may do inside
 *   one studio (tenant), e.g. Angelus Media Productions.
 */
export const PLATFORM_ROLES = ['super-admin', 'user'] as const
export type PlatformRole = (typeof PLATFORM_ROLES)[number]

export const TENANT_STAFF_ROLES = [
  'admin',
  'production-manager',
  'photographer',
  'videographer',
  'editor',
  'finance-manager',
] as const

export const TENANT_ROLES = [...TENANT_STAFF_ROLES, 'event-organizer', 'client'] as const
export type TenantRole = (typeof TENANT_ROLES)[number]

export const PLATFORM_ROLE_LABELS: Record<PlatformRole, string> = {
  'super-admin': 'Platform super administrator',
  user: 'User',
}

export const TENANT_ROLE_LABELS: Record<TenantRole, string> = {
  admin: 'Studio administrator',
  'production-manager': 'Production manager',
  photographer: 'Photographer',
  videographer: 'Videographer',
  editor: 'Editor',
  'finance-manager': 'Finance manager',
  'event-organizer': 'Event organizer',
  client: 'Client',
}

export type TenantId = number | string

/** Minimal shape of a membership row; `tenant` may be an id or a populated document. */
export type Membership = {
  tenant?: TenantId | { id: TenantId } | null
  roles?: readonly string[] | null
}

/** Minimal shape of an authenticated user that the helpers need. */
export type Actor =
  | {
      id?: TenantId
      roles?: readonly string[] | null
      tenants?: readonly Membership[] | null
    }
  | null
  | undefined

export const tenantIdOf = (membership: Membership): TenantId | null => {
  const { tenant } = membership
  if (tenant === null || tenant === undefined) return null
  return typeof tenant === 'object' ? tenant.id : tenant
}

export const isSuperAdmin = (user: Actor): boolean => Boolean(user?.roles?.includes('super-admin'))

/** Ids of the tenants where the user holds at least one of `roles`. */
export function tenantIdsWithRole(user: Actor, roles: readonly TenantRole[]): TenantId[] {
  if (!user?.tenants) return []
  const ids: TenantId[] = []
  for (const membership of user.tenants) {
    const id = tenantIdOf(membership)
    if (id === null) continue
    if (membership.roles?.some((role) => (roles as readonly string[]).includes(role))) ids.push(id)
  }
  return ids
}

export const hasTenantRole = (
  user: Actor,
  tenantId: TenantId,
  roles: readonly TenantRole[],
): boolean => tenantIdsWithRole(user, roles).some((id) => String(id) === String(tenantId))

/** Can open the admin panel: platform super admins and staff of at least one studio. */
export const isStaffAnywhere = (user: Actor): boolean =>
  isSuperAdmin(user) || tenantIdsWithRole(user, TENANT_STAFF_ROLES).length > 0

/**
 * Decides whether `actor` may change a user's platform roles from `previous` to `next`.
 * Only platform super admins can grant or remove platform roles.
 */
export function canChangePlatformRoles(
  actor: Actor,
  previous: readonly string[],
  next: readonly string[],
): boolean {
  const unchanged =
    previous.length === next.length && previous.every((role) => next.includes(role))
  return unchanged || isSuperAdmin(actor)
}

const membershipKey = (m: Membership) =>
  `${String(tenantIdOf(m))}:${[...(m.roles ?? [])].sort().join(',')}`

/**
 * Decides whether `actor` may change a user's studio memberships from `previous` to `next`.
 * Super admins may change anything. A studio administrator may only add, remove or
 * re-role memberships for studios they administer, and never their own memberships.
 */
export function canChangeMemberships(
  actor: Actor,
  target: { id?: TenantId } | null | undefined,
  previous: readonly Membership[],
  next: readonly Membership[],
): boolean {
  if (isSuperAdmin(actor)) return true

  const before = new Set(previous.map(membershipKey))
  const after = new Set(next.map(membershipKey))
  const changed = [
    ...previous.filter((m) => !after.has(membershipKey(m))),
    ...next.filter((m) => !before.has(membershipKey(m))),
  ]
  if (changed.length === 0) return true

  const editingSelf = target?.id !== undefined && String(target.id) === String(actor?.id)
  if (editingSelf) return false

  const administered = new Set(tenantIdsWithRole(actor, ['admin']).map(String))
  return changed.every((m) => {
    const id = tenantIdOf(m)
    return id !== null && administered.has(String(id))
  })
}
