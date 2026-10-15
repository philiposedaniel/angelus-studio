import config from '@payload-config'
import { headers } from 'next/headers'
import { getPayload } from 'payload'
import { cache } from 'react'

import type { Tenant } from '@/payload-types'

const hostOf = (value: string | null): string | null =>
  value ? value.split(',')[0]!.trim().toLowerCase().replace(/:\d+$/, '') : null

/**
 * The studio whose public website is being requested, chosen by host name.
 * DEFAULT_TENANT_SLUG is the fallback for local development and single-studio installs.
 */
export const getCurrentTenant = cache(async (): Promise<Tenant | null> => {
  const payload = await getPayload({ config })
  const requestHeaders = await headers()
  const host = hostOf(requestHeaders.get('x-forwarded-host') ?? requestHeaders.get('host'))

  if (host) {
    const { docs } = await payload.find({
      collection: 'tenants',
      where: { domain: { equals: host } },
      limit: 1,
      depth: 0,
    })
    if (docs[0]) return docs[0]
  }

  const fallback = process.env.DEFAULT_TENANT_SLUG
  if (!fallback) return null
  const { docs } = await payload.find({
    collection: 'tenants',
    where: { slug: { equals: fallback } },
    limit: 1,
    depth: 0,
  })
  return docs[0] ?? null
})
