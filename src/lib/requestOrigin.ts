import { headers } from 'next/headers'
import type { Payload } from 'payload'

/**
 * Where Stripe sends the visitor back: the studio's own domain when it has one, so a forged
 * Host header cannot choose it; otherwise the address the visitor is on.
 */
export async function requestOrigin(payload: Payload, tenantId: number) {
  const tenant = await payload.findByID({ collection: 'tenants', id: tenantId, depth: 0 }).catch(() => null)
  if (tenant?.domain) return `https://${tenant.domain}`
  const requestHeaders = await headers()
  const host = requestHeaders.get('x-forwarded-host') ?? requestHeaders.get('host')
  const proto = requestHeaders.get('x-forwarded-proto') ?? (process.env.NODE_ENV === 'production' ? 'https' : 'http')
  return `${proto}://${host}`
}
