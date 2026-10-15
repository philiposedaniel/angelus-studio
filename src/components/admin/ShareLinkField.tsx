import type { UIFieldServerProps } from 'payload'

import { idOf } from '@/lib/ids'
import { isShareToken } from '@/lib/shareTokens'

import { CopyButton } from './CopyButton'

/** The studio's own site address when it has one, so links open on the studio's domain. */
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

const escapeAttribute = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')

/** Shows a gallery's share link and the code to embed it on a website, in the admin sidebar. */
export async function ShareLinkField(props: UIFieldServerProps) {
  const token = props.data?.shareToken
  const box: React.CSSProperties = { display: 'grid', gap: 8, marginBottom: 24 }
  if (!isShareToken(token)) {
    return (
      <div style={box}>
        <p style={{ margin: 0 }}>Save the gallery to create its share link.</p>
      </div>
    )
  }
  const url = `${await siteOrigin(props)}/s/${token}`
  const title = typeof props.data?.title === 'string' ? props.data.title : 'Photo album'
  const embed = `<iframe src="${url}/embed" title="${escapeAttribute(title)}" width="100%" height="640" style="border:0" loading="lazy" allowfullscreen></iframe>`
  const field: React.CSSProperties = { width: '100%', fontFamily: 'monospace', fontSize: 12 }

  return (
    <div style={box}>
      <strong>Share link</strong>
      <input readOnly value={url} aria-label="Share link" style={field} />
      <div style={{ display: 'flex', gap: 8 }}>
        <CopyButton value={url} label="Copy link" />
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="btn btn--style-secondary btn--size-small"
          style={{ margin: 0 }}
        >
          Open
        </a>
      </div>
      <strong style={{ marginTop: 8 }}>Embed on a website</strong>
      <textarea readOnly value={embed} rows={5} aria-label="Embed code" style={field} />
      <div>
        <CopyButton value={embed} label="Copy embed code" />
      </div>
      <p style={{ margin: 0, fontSize: 12, opacity: 0.75 }}>
        Viewers see web-size copies only. Published, unexpired galleries only.
      </p>
    </div>
  )
}
