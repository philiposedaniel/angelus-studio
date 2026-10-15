import { describe, expect, it } from 'vitest'

import { canChangeRoles, hasAnyRole, isAdmin, isStaff, isSuperAdmin } from '@/access/roles'

const superAdmin = { roles: ['super-admin'] }
const admin = { roles: ['admin'] }
const photographer = { roles: ['photographer'] }
const client = { roles: ['client'] }

describe('role helpers', () => {
  it('denies by default when there is no user or no roles', () => {
    expect(hasAnyRole(null, ['admin'])).toBe(false)
    expect(hasAnyRole(undefined, ['admin'])).toBe(false)
    expect(hasAnyRole({ roles: [] }, ['admin'])).toBe(false)
    expect(hasAnyRole({ roles: null }, ['admin'])).toBe(false)
  })

  it('classifies admins, staff and clients', () => {
    expect(isAdmin(superAdmin)).toBe(true)
    expect(isAdmin(admin)).toBe(true)
    expect(isAdmin(photographer)).toBe(false)
    expect(isStaff(photographer)).toBe(true)
    expect(isStaff(client)).toBe(false)
    expect(isSuperAdmin(admin)).toBe(false)
  })

  it('ignores unknown role strings', () => {
    expect(isStaff({ roles: ['owner', 'root'] })).toBe(false)
  })
})

describe('canChangeRoles', () => {
  it('allows saving a user without changing roles', () => {
    expect(canChangeRoles(client, ['client'], ['client'])).toBe(true)
  })

  it('stops non-admins from changing roles', () => {
    expect(canChangeRoles(client, ['client'], ['admin'])).toBe(false)
    expect(canChangeRoles(photographer, ['photographer'], ['photographer', 'editor'])).toBe(false)
  })

  it('lets admins assign ordinary roles', () => {
    expect(canChangeRoles(admin, ['client'], ['photographer'])).toBe(true)
  })

  it('reserves granting and removing super admin for super admins', () => {
    expect(canChangeRoles(admin, ['client'], ['super-admin'])).toBe(false)
    expect(canChangeRoles(admin, ['super-admin'], ['admin'])).toBe(false)
    expect(canChangeRoles(superAdmin, ['admin'], ['super-admin'])).toBe(true)
  })
})
