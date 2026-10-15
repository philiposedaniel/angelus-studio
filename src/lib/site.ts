import config from '@payload-config'
import { getPayload } from 'payload'
import { cache } from 'react'

import type { Locale } from '@/i18n/config'

/*
 * Public reads run with public access rules (no user, overrideAccess off) and are
 * always filtered to one studio, so one studio's site never shows another's content.
 */

export const getSiteSettings = cache(async (tenantId: number, locale: Locale) => {
  const payload = await getPayload({ config })
  const { docs } = await payload.find({
    collection: 'site-settings',
    overrideAccess: false,
    where: { tenant: { equals: tenantId } },
    limit: 1,
    depth: 1,
    locale,
  })
  return docs[0] ?? null
})

export const getPublishedServices = cache(async (tenantId: number, locale: Locale) => {
  const payload = await getPayload({ config })
  const { docs } = await payload.find({
    collection: 'services',
    overrideAccess: false,
    where: { and: [{ published: { equals: true } }, { tenant: { equals: tenantId } }] },
    sort: 'order',
    limit: 24,
    depth: 1,
    locale,
  })
  return docs
})
