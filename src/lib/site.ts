import config from '@payload-config'
import { getPayload } from 'payload'
import { cache } from 'react'

/** Public site settings, read with public access rules (no user, overrideAccess off). */
export const getSiteSettings = cache(async () => {
  const payload = await getPayload({ config })
  return payload.findGlobal({ slug: 'site-settings', overrideAccess: false, depth: 1 })
})

export const getPublishedServices = cache(async () => {
  const payload = await getPayload({ config })
  const { docs } = await payload.find({
    collection: 'services',
    overrideAccess: false,
    where: { published: { equals: true } },
    sort: 'order',
    limit: 24,
    depth: 1,
  })
  return docs
})
