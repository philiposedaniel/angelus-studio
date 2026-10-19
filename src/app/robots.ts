import type { MetadataRoute } from 'next'

import { PRIVATE_PATHS, siteOrigin } from '@/lib/seo'
import { getCurrentTenant } from '@/lib/tenant'

// Answered per request: the studio depends on the host, and the build has no database.
export const dynamic = 'force-dynamic'

/**
 * robots.txt: the studio's public pages are open and the sitemap is named; private pages are not crawled.
 * Without a domain on the studio (previews, local development) the whole site is closed to crawlers.
 */
export default async function robots(): Promise<MetadataRoute.Robots> {
  const tenant = await getCurrentTenant()
  const origin = tenant ? siteOrigin(tenant) : null
  if (!origin) return { rules: { userAgent: '*', disallow: '/' } }

  return {
    rules: { userAgent: '*', allow: '/', disallow: PRIVATE_PATHS },
    sitemap: `${origin}/sitemap.xml`,
  }
}
