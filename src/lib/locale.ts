import { headers } from 'next/headers'
import { notFound, redirect } from 'next/navigation'

import { DEFAULT_LOCALE, isLocale, negotiateLocale, type Locale } from '@/i18n/config'
import type { Tenant } from '@/payload-types'

export const tenantLocales = (tenant: Tenant): Locale[] => {
  const locales = (tenant.languages ?? []).filter(isLocale)
  return locales.length > 0 ? locales : [DEFAULT_LOCALE]
}

/**
 * Validates the language in the URL against what the studio offers. Unknown codes are a
 * 404; a supported language the studio does not offer redirects to its best alternative.
 */
export async function resolveLocale(tenant: Tenant, requested: string): Promise<Locale> {
  if (!isLocale(requested)) notFound()
  const offered = tenantLocales(tenant)
  if (offered.includes(requested)) return requested
  const fallback = isLocale(tenant.defaultLocale) && offered.includes(tenant.defaultLocale)
    ? tenant.defaultLocale
    : offered[0]!
  const best = negotiateLocale((await headers()).get('accept-language'), offered, fallback)
  redirect(`/${best}`)
}
