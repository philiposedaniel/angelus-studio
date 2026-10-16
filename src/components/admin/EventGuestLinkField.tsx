import type { UIFieldServerProps } from 'payload'

import { idOf } from '@/lib/ids'
import { isShareToken } from '@/lib/shareTokens'

import { CopyButton } from './CopyButton'

/** The studio's own site address when it has one, so the link opens on the studio's domain. */
async function siteOrigin(props: UIFieldServerProps) {
  const tenantId = idOf(props.data?.tenant)
  if (tenantId !== undefined) {
    const tenant = await props.payload
      .findByID({ collection: 'tenants', id: tenantId, depth: 0 })
      .catch(() => null)
    if (tenant?.domain) return `https://${tenant.domain}`
  }
  return (process.env.NEXT_PUBLIC_SERVER_URL ?? '').replace(/\/$/, '')
}

/** The guest link for an event. Guests open it to reach the event's album. */
export async function EventGuestLinkField(props: UIFieldServerProps) {
  const token = props.data?.guestToken
  const slug = props.data?.slug
  const box: React.CSSProperties = { display: 'grid', gap: 8, marginBottom: 24 }
  if (!isShareToken(token) || typeof slug !== 'string' || !slug) {
    return (
      <div style={box}>
        <p style={{ margin: 0 }}>Save the event to create its guest link.</p>
      </div>
    )
  }
  const url = `${await siteOrigin(props)}/en/events/${slug}/guests/${token}`
  const field: React.CSSProperties = { width: '100%', fontFamily: 'monospace', fontSize: 12 }

  return (
    <div style={box}>
      <strong>Guest link</strong>
      <input readOnly value={url} aria-label="Guest link" style={field} />
      <div>
        <CopyButton value={url} label="Copy guest link" />
      </div>
      <p style={{ margin: 0, fontSize: 12, opacity: 0.75 }}>
        Guests use this link to open the event album. It works only while the event is published and
        the album is published and shared.
      </p>
    </div>
  )
}
