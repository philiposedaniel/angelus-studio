'use server'

import config from '@payload-config'
import { redirect } from 'next/navigation'
import { getPayload } from 'payload'

import { requirePortalUser } from '@/lib/auth'
import { disableMfa, enableMfa } from '@/lib/mfa'
import { getCurrentTenant } from '@/lib/tenant'

const field = (formData: FormData, name: string) => {
  const value = formData.get(name)
  return typeof value === 'string' ? value : ''
}

/** Turns authenticator sign-in on, after the person enters a code from the secret the page showed them. */
export async function enableMfaAction(formData: FormData) {
  const locale = field(formData, 'locale')
  const tenant = await getCurrentTenant()
  if (!tenant) redirect(`/${locale}/portal/login`)
  const user = await requirePortalUser(tenant, locale)
  const payload = await getPayload({ config })
  const ok = await enableMfa(payload, user.id, field(formData, 'secret'), field(formData, 'code'))
  redirect(`/${locale}/portal/security?status=${ok ? 'enabled' : 'invalid'}`)
}

/** Turns authenticator sign-in off, given a current code. */
export async function disableMfaAction(formData: FormData) {
  const locale = field(formData, 'locale')
  const tenant = await getCurrentTenant()
  if (!tenant) redirect(`/${locale}/portal/login`)
  const user = await requirePortalUser(tenant, locale)
  const payload = await getPayload({ config })
  const outcome = await disableMfa(payload, user.id, field(formData, 'code'))
  const status = outcome === 'ok' ? 'disabled' : outcome === 'locked' ? 'locked' : 'invalid'
  redirect(`/${locale}/portal/security?status=${status}`)
}
