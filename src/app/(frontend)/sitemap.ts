import config from '@payload-config'
import type { MetadataRoute } from 'next'
import { getPayload } from 'payload'

import { websiteSitemapEntries } from '@/lib/seo'
import { getCurrentTenant } from '@/lib/tenant'

// Answered per request: the studio depends on the host, and the build has no database.
export const dynamic = 'force-dynamic'

/** sitemap.xml for the studio whose website the request is for. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const tenant = await getCurrentTenant()
  if (!tenant) return []
  const payload = await getPayload({ config })
  return websiteSitemapEntries(payload, tenant)
}
