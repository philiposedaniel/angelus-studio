import { headers } from 'next/headers'

import { isLocale, negotiateLocale, type Locale } from '@/i18n/config'
import type { Tenant } from '@/payload-types'

import { tenantLocales } from './locale'

/**
 * Share links have no language in the path, so they work wherever they are pasted.
 * `?lang=` picks one the studio offers; otherwise the visitor's browser language decides.
 */
export async function shareLocale(tenant: Tenant, requested?: string | string[]): Promise<Locale> {
  const offered = tenantLocales(tenant)
  const lang = typeof requested === 'string' ? requested : undefined
  if (isLocale(lang) && offered.includes(lang)) return lang
  const fallback =
    isLocale(tenant.defaultLocale) && offered.includes(tenant.defaultLocale)
      ? tenant.defaultLocale
      : offered[0]!
  return negotiateLocale((await headers()).get('accept-language'), offered, fallback)
}
