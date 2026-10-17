import type { UIFieldServerProps } from 'payload'

import { idOf } from '@/lib/ids'
import { tenantLocales } from '@/lib/locale'
import { isShareToken } from '@/lib/shareTokens'
import { siteOrigin } from '@/lib/siteOrigin'

import { CopyButton } from './CopyButton'

/** Someone's waitlist link, to resend to them if they lost it. */
export async function WaitlistLinkField(props: UIFieldServerProps) {
  const token = props.data?.claimToken
  const tenantId = idOf(props.data?.tenant)
  const tenant =
    tenantId === undefined
      ? null
      : await props.payload.findByID({ collection: 'tenants', id: tenantId, depth: 0 }).catch(() => null)
  const offered = tenant ? tenantLocales(tenant) : ['en']
  const language = offered.includes(props.data?.language) ? props.data?.language : offered[0]
  const box: React.CSSProperties = { display: 'grid', gap: 8, marginBottom: 24 }
  if (!isShareToken(token)) {
    return (
      <div style={box}>
        <p style={{ margin: 0 }}>The waitlist link appears once the person has joined.</p>
      </div>
    )
  }
  const url = `${await siteOrigin(props.payload, props.data?.tenant)}/${language}/waitlist/${token}`
  const field: React.CSSProperties = { width: '100%', fontFamily: 'monospace', fontSize: 12 }

  return (
    <div style={box}>
      <strong>Waitlist link</strong>
      <input readOnly value={url} aria-label="Waitlist link" style={field} />
      <div>
        <CopyButton value={url} label="Copy waitlist link" />
      </div>
      <p style={{ margin: 0, fontSize: 12, opacity: 0.75 }}>
        Where the person sees their place in line and claims the places offered to them. Anyone
        with the link can claim them, so send it only to that person.
      </p>
    </div>
  )
}
