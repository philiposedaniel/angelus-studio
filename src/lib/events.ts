import config from '@payload-config'
import { getPayload } from 'payload'
import { cache } from 'react'

import type { Locale } from '@/i18n/config'

/*
 * Public reads run with public access rules (no user, overrideAccess off), so only published
 * events of this studio come back, and the guest token is never returned.
 */

export const listPublishedEvents = cache(async (tenantId: number, locale: Locale) => {
  const payload = await getPayload({ config })
  const { docs } = await payload.find({
    collection: 'events',
    overrideAccess: false,
    where: { and: [{ published: { equals: true } }, { tenant: { equals: tenantId } }] },
    sort: 'startsAt',
    limit: 100,
    depth: 1,
    locale,
  })
  return docs
})

export const getPublishedEvent = cache(async (tenantId: number, slug: string, locale: Locale) => {
  const payload = await getPayload({ config })
  const { docs } = await payload.find({
    collection: 'events',
    overrideAccess: false,
    where: {
      and: [{ published: { equals: true } }, { tenant: { equals: tenantId } }, { slug: { equals: slug } }],
    },
    limit: 1,
    depth: 1,
    locale,
  })
  return docs[0] ?? null
})
