import config from '@payload-config'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { getPayload } from 'payload'
import { cache } from 'react'

import { isSuperAdmin } from '@/access/roles'
import type { Tenant, User } from '@/payload-types'

/** The signed-in user for this request, or null. */
export const getSessionUser = cache(async (): Promise<User | null> => {
  const payload = await getPayload({ config })
  const { user } = await payload.auth({ headers: await headers() })
  return (user as User | null) ?? null
})

const isMemberOf = (user: User, tenant: Tenant) =>
  isSuperAdmin(user) ||
  (user.tenants ?? []).some((m) => {
    const id = typeof m.tenant === 'object' ? m.tenant.id : m.tenant
    return String(id) === String(tenant.id)
  })

/** The signed-in member of this studio, or null. For route handlers, which cannot redirect to the login page. */
export async function getPortalUser(tenant: Tenant): Promise<User | null> {
  const user = await getSessionUser()
  return user && isMemberOf(user, tenant) ? user : null
}

/** Requires a signed-in member of this studio; otherwise sends them to the login page. */
export async function requirePortalUser(tenant: Tenant, locale: string): Promise<User> {
  const user = await getPortalUser(tenant)
  if (!user) redirect(`/${locale}/portal/login`)
  return user
}
