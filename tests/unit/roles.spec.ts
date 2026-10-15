import { describe, expect, it } from 'vitest'

import {
  canChangeMemberships,
  canChangePlatformRoles,
  hasTenantRole,
  isStaffAnywhere,
  isSuperAdmin,
  tenantIdsWithRole,
} from '@/access/roles'

const superAdmin = { id: 1, roles: ['super-admin'], tenants: [] }
const adminA = { id: 2, roles: ['user'], tenants: [{ tenant: 10, roles: ['admin'] }] }
const photographerA = { id: 3, roles: ['user'], tenants: [{ tenant: { id: 10 }, roles: ['photographer'] }] }
const clientA = { id: 4, roles: ['user'], tenants: [{ tenant: 10, roles: ['client'] }] }

describe('role helpers', () => {
  it('denies by default when there is no user, roles or memberships', () => {
    expect(isSuperAdmin(null)).toBe(false)
    expect(isStaffAnywhere(undefined)).toBe(false)
    expect(tenantIdsWithRole({ roles: ['user'] }, ['admin'])).toEqual([])
    expect(isStaffAnywhere({ roles: ['user'], tenants: [{ tenant: 10, roles: null }] })).toBe(false)
  })

  it('reads studio roles from ids and populated tenants', () => {
    expect(tenantIdsWithRole(adminA, ['admin'])).toEqual([10])
    expect(tenantIdsWithRole(photographerA, ['photographer'])).toEqual([10])
    expect(hasTenantRole(photographerA, '10', ['photographer'])).toBe(true)
    expect(hasTenantRole(photographerA, 11, ['photographer'])).toBe(false)
  })

  it('lets staff and super admins into the admin panel, but not clients', () => {
    expect(isStaffAnywhere(superAdmin)).toBe(true)
    expect(isStaffAnywhere(photographerA)).toBe(true)
    expect(isStaffAnywhere(clientA)).toBe(false)
  })

  it('ignores unknown role strings', () => {
    expect(isStaffAnywhere({ roles: ['root'], tenants: [{ tenant: 10, roles: ['owner'] }] })).toBe(false)
  })
})

describe('canChangePlatformRoles', () => {
  it('allows saving without a change and reserves changes for super admins', () => {
    expect(canChangePlatformRoles(clientA, ['user'], ['user'])).toBe(true)
    expect(canChangePlatformRoles(adminA, ['user'], ['super-admin'])).toBe(false)
    expect(canChangePlatformRoles(superAdmin, ['user'], ['super-admin'])).toBe(true)
  })
})

describe('canChangeMemberships', () => {
  const target = { id: 99 }

  it('lets a studio admin manage memberships in their own studio', () => {
    expect(canChangeMemberships(adminA, target, [], [{ tenant: 10, roles: ['client'] }])).toBe(true)
    expect(
      canChangeMemberships(adminA, target, [{ tenant: 10, roles: ['client'] }], [{ tenant: 10, roles: ['photographer'] }]),
    ).toBe(true)
  })

  it('stops a studio admin touching another studio', () => {
    expect(canChangeMemberships(adminA, target, [], [{ tenant: 11, roles: ['client'] }])).toBe(false)
    expect(canChangeMemberships(adminA, target, [{ tenant: 11, roles: ['admin'] }], [])).toBe(false)
  })

  it('stops anyone but a super admin changing their own memberships', () => {
    expect(
      canChangeMemberships(adminA, adminA, adminA.tenants, [...adminA.tenants, { tenant: 11, roles: ['admin'] }]),
    ).toBe(false)
    expect(canChangeMemberships(superAdmin, superAdmin, [], [{ tenant: 11, roles: ['admin'] }])).toBe(true)
  })

  it('stops non-admin staff and clients changing memberships', () => {
    expect(canChangeMemberships(photographerA, target, [], [{ tenant: 10, roles: ['client'] }])).toBe(false)
    expect(canChangeMemberships(clientA, target, [], [{ tenant: 10, roles: ['admin'] }])).toBe(false)
  })

  it('treats an unchanged list as no change, whatever the order', () => {
    const rows = [
      { tenant: 10, roles: ['client', 'editor'] },
      { tenant: 11, roles: ['admin'] },
    ]
    expect(canChangeMemberships(clientA, target, rows, [...rows].reverse())).toBe(true)
  })
})
