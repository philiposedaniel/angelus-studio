import type { Payload } from 'payload'

import { idOf } from '@/lib/ids'

/** The studio's own site address when it has one, so links open on the studio's domain. */
export async function siteOrigin(payload: Payload, tenant: unknown) {
  const tenantId = idOf(tenant)
  if (tenantId !== undefined) {
    const found = await payload.findByID({ collection: 'tenants', id: tenantId, depth: 0 }).catch(() => null)
    if (found?.domain) return `https://${found.domain}`
  }
  return (process.env.NEXT_PUBLIC_SERVER_URL ?? '').replace(/\/$/, '')
}
