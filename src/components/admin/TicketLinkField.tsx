import type { UIFieldServerProps } from 'payload'

import { idOf } from '@/lib/ids'
import { tenantLocales } from '@/lib/locale'
import { isShareToken } from '@/lib/shareTokens'
import { siteOrigin } from '@/lib/siteOrigin'

import { CopyButton } from './CopyButton'

/** A registration's ticket link, to resend to someone who lost it. */
export async function TicketLinkField(props: UIFieldServerProps) {
  const token = props.data?.ticketToken
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
        <p style={{ margin: 0 }}>Save the registration to create its ticket link.</p>
      </div>
    )
  }
  const url = `${await siteOrigin(props.payload, props.data?.tenant)}/${language}/tickets/${token}`
  const field: React.CSSProperties = { width: '100%', fontFamily: 'monospace', fontSize: 12 }

  return (
    <div style={box}>
      <strong>Ticket link</strong>
      <input readOnly value={url} aria-label="Ticket link" style={field} />
      <div>
        <CopyButton value={url} label="Copy ticket link" />
      </div>
      <p style={{ margin: 0, fontSize: 12, opacity: 0.75 }}>
        The person&apos;s ticket, with the entry code staff scan at the door. Anyone with the link can
        show it, so send it only to them.
      </p>
    </div>
  )
}
