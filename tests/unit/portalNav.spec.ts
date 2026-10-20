import { describe, expect, it } from 'vitest'

import { showStaffPortalLinks } from '@/lib/portalNav'

const STUDIO = 1
const OTHER_STUDIO = 2

const user = (roles: string[], tenants: { tenant: number; roles: string[] }[] = []) => ({ id: 10, roles, tenants })

describe('portal staff links', () => {
  it('shows the calendar and sign-in security links to staff of this studio', () => {
    expect(showStaffPortalLinks(user(['user'], [{ tenant: STUDIO, roles: ['production-manager'] }]), STUDIO)).toBe(true)
    expect(showStaffPortalLinks(user(['user'], [{ tenant: STUDIO, roles: ['admin'] }]), STUDIO)).toBe(true)
  })

  it('shows them to platform super admins', () => {
    expect(showStaffPortalLinks(user(['super-admin']), STUDIO)).toBe(true)
  })

  it('hides them from clients of this studio', () => {
    expect(showStaffPortalLinks(user(['user'], [{ tenant: STUDIO, roles: ['client'] }]), STUDIO)).toBe(false)
  })

  it('hides them from event organizers of this studio', () => {
    expect(showStaffPortalLinks(user(['user'], [{ tenant: STUDIO, roles: ['event-organizer'] }]), STUDIO)).toBe(false)
  })

  it('hides them from staff of another studio', () => {
    expect(showStaffPortalLinks(user(['user'], [{ tenant: OTHER_STUDIO, roles: ['admin'] }]), STUDIO)).toBe(false)
  })

  it('hides them from a user with no memberships', () => {
    expect(showStaffPortalLinks(user(['user']), STUDIO)).toBe(false)
    expect(showStaffPortalLinks(null, STUDIO)).toBe(false)
  })
})
