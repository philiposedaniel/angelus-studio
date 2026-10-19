import type { MetadataRoute } from 'next'
import type { Payload } from 'payload'

import { tenantLocales } from '@/lib/locale'
import type { Tenant } from '@/payload-types'

/**
 * The address a studio's public website is served from, from its host name. Local hosts use http,
 * everything else https. Returns null when the studio has no domain yet, so no absolute URLs are made.
 */
export function siteOrigin(tenant: Pick<Tenant, 'domain'>): string | null {
  const host = tenant.domain?.trim()
  if (!host) return null
  const scheme = /^localhost(:\d+)?$/.test(host) ? 'http' : 'https'
  return `${scheme}://${host}`
}

/**
 * Public paths that belong to one client or guest, not to the search index. Listed in robots.txt so
 * crawlers skip them; the server still protects them with their tokens and sign-in.
 */
export const PRIVATE_PATHS = [
  '/admin',
  '/api/',
  '/healthz',
  '/s/',
  '/*/portal',
  '/*/quote/',
  '/*/invite/',
  '/*/tickets/',
  '/*/vendor/',
  '/*/waitlist/',
  '/*/events/*/guests/',
]

/**
 * Sitemap entries for a studio's website: the home page and every published page, in each language
 * the studio offers. Only the studio's own published pages are listed, so another studio's pages
 * never appear, even if the slugs match.
 */
export async function websiteSitemapEntries(
  payload: Payload,
  tenant: Tenant,
): Promise<MetadataRoute.Sitemap> {
  const origin = siteOrigin(tenant)
  if (!origin) return []

  const locales = tenantLocales(tenant)
  const { docs: pages } = await payload.find({
    collection: 'pages',
    overrideAccess: false,
    pagination: false,
    depth: 0,
    where: { and: [{ tenant: { equals: tenant.id } }, { published: { equals: true } }] },
  })

  const alternates = (path: string) => ({
    languages: Object.fromEntries(locales.map((code) => [code, `${origin}/${code}${path}`])),
  })

  const entries: MetadataRoute.Sitemap = locales.map((code) => ({
    url: `${origin}/${code}`,
    alternates: alternates(''),
    changeFrequency: 'weekly',
    priority: 1,
  }))

  for (const page of pages) {
    for (const code of locales) {
      entries.push({
        url: `${origin}/${code}/${page.slug}`,
        lastModified: page.updatedAt,
        alternates: alternates(`/${page.slug}`),
        changeFrequency: 'monthly',
        priority: 0.7,
      })
    }
  }

  return entries
}
