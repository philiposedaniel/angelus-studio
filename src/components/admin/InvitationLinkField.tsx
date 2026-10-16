import type { UIFieldServerProps } from 'payload'

import { idOf } from '@/lib/ids'
import { tenantLocales } from '@/lib/locale'
import { isShareToken } from '@/lib/shareTokens'

import { CopyButton } from './CopyButton'
import { siteOrigin } from '@/lib/siteOrigin'

/** A guest's personal invitation link, to copy and send them. */
export async function InvitationLinkField(props: UIFieldServerProps) {
  const token = props.data?.inviteToken
  const tenantId = idOf(props.data?.tenant)
  const tenant =
    tenantId === undefined
      ? null
      : await props.payload.findByID({ collection: 'tenants', id: tenantId, depth: 0 }).catch(() => null)
  // A language the studio's site does not offer would send the guest to the homepage instead.
  const offered = tenant ? tenantLocales(tenant) : ['en']
  const language = offered.includes(props.data?.language) ? props.data?.language : offered[0]
  const box: React.CSSProperties = { display: 'grid', gap: 8, marginBottom: 24 }
  if (!isShareToken(token)) {
    return (
      <div style={box}>
        <p style={{ margin: 0 }}>Save the guest to create their invitation link.</p>
      </div>
    )
  }
  const url = `${await siteOrigin(props.payload, props.data?.tenant)}/${language}/invite/${token}`
  const field: React.CSSProperties = { width: '100%', fontFamily: 'monospace', fontSize: 12 }

  return (
    <div style={box}>
      <strong>Invitation link</strong>
      <input readOnly value={url} aria-label="Invitation link" style={field} />
      <div>
        <CopyButton value={url} label="Copy invitation link" />
      </div>
      <p style={{ margin: 0, fontSize: 12, opacity: 0.75 }}>
        Send this link to the guest. It is theirs alone: it shows the event and lets them reply for
        their party. It works while the event is published, even when the event is not shown on the
        website.
      </p>
    </div>
  )
}
