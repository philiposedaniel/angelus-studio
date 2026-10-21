import { headers } from 'next/headers'
import { notFound, redirect } from 'next/navigation'

import { DEFAULT_LOCALE, isLocale, negotiateLocale, PATH_HEADER, pathInLocale, type Locale } from '@/i18n/config'
import type { Tenant } from '@/payload-types'

export const tenantLocales = (tenant: Tenant): Locale[] => {
  const locales = (tenant.languages ?? []).filter(isLocale)
  return locales.length > 0 ? locales : [DEFAULT_LOCALE]
}

/**
 * Validates the language in the URL against what the studio offers. Unknown codes are a
 * 404; a supported language the studio does not offer redirects to the same page in its best
 * alternative, so a guest's or buyer's link in such a language still opens their page.
 */
export async function resolveLocale(tenant: Tenant, requested: string): Promise<Locale> {
  if (!isLocale(requested)) notFound()
  const offered = tenantLocales(tenant)
  if (offered.includes(requested)) return requested
  const fallback =
    isLocale(tenant.defaultLocale) && offered.includes(tenant.defaultLocale)
      ? tenant.defaultLocale
      : offered[0]!
  const request = await headers()
  const best = negotiateLocale(request.get('accept-language'), offered, fallback)
  redirect(pathInLocale(request.get(PATH_HEADER), requested, best))
}
