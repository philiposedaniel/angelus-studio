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

/** Published pages the studio chose to list in the site menu. */
export const getMenuPages = cache(async (tenantId: number, locale: Locale) => {
  const payload = await getPayload({ config })
  const { docs } = await payload.find({
    collection: 'pages',
    overrideAccess: false,
    where: {
      and: [
        { published: { equals: true } },
        { showInMenu: { equals: true } },
        { tenant: { equals: tenantId } },
      ],
    },
    sort: 'menuOrder',
    limit: 8,
    depth: 0,
    locale,
    select: { title: true, slug: true },
  })
  return docs.map((page) => ({ title: page.title, slug: page.slug }))
})

export const getPublishedPage = cache(async (tenantId: number, slug: string, locale: Locale) => {
  const payload = await getPayload({ config })
  const { docs } = await payload.find({
    collection: 'pages',
    overrideAccess: false,
    where: {
      and: [
        { published: { equals: true } },
        { tenant: { equals: tenantId } },
        { slug: { equals: slug } },
      ],
    },
    limit: 1,
    // Depth 1 brings in cover images; galleries are re-checked separately (see SharedAlbumBlock).
    depth: 1,
    locale,
  })
  return docs[0] ?? null
})
