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

/** Shows the client's quote link in the admin. The link works once the quote is sent. */
export async function QuoteLinkField(props: UIFieldServerProps) {
  const token = props.data?.publicToken
  const box: React.CSSProperties = { display: 'grid', gap: 8, marginBottom: 24 }
  if (!isShareToken(token)) {
    return (
      <div style={box}>
        <p style={{ margin: 0 }}>Save the quote to create its link.</p>
      </div>
    )
  }
  const url = `${await siteOrigin(props)}/en/quote/${token}`
  const field: React.CSSProperties = { width: '100%', fontFamily: 'monospace', fontSize: 12 }

  return (
    <div style={box}>
      <strong>Client link</strong>
      <input readOnly value={url} aria-label="Client link" style={field} />
      <div>
        <CopyButton value={url} label="Copy link" />
      </div>
      <p style={{ margin: 0, fontSize: 12, opacity: 0.75 }}>
        The client opens this link and pays the deposit. It works only while the quote is
        sent and not expired. The link opens in English; the client can switch language on the site.
      </p>
    </div>
  )
}
