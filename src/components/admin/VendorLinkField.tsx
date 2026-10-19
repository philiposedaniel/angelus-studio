import type { UIFieldServerProps } from 'payload'

import { emailConfigured } from '@/lib/email'
import { idOf } from '@/lib/ids'
import { tenantLocales } from '@/lib/locale'
import { isShareToken } from '@/lib/shareTokens'
import { siteOrigin } from '@/lib/siteOrigin'

import { CopyButton } from './CopyButton'
import { SendInvitationsButton } from './SendInvitationsButton'

/** The vendor's private link for this booking, to copy and send them. */
export async function VendorLinkField(props: UIFieldServerProps) {
  const token = props.data?.vendorToken
  const box: React.CSSProperties = { display: 'grid', gap: 8, marginBottom: 24 }
  if (!isShareToken(token)) {
    return (
      <div style={box}>
        <p style={{ margin: 0 }}>Save the booking to create the vendor&apos;s link.</p>
      </div>
    )
  }
  const tenantId = idOf(props.data?.tenant)
  const tenant =
    tenantId === undefined
      ? null
      : await props.payload.findByID({ collection: 'tenants', id: tenantId, depth: 0 }).catch(() => null)
  const language = tenant ? tenantLocales(tenant)[0] : 'en'
  const url = `${await siteOrigin(props.payload, props.data?.tenant)}/${language}/vendor/${token}`

  return (
    <div style={box}>
      <strong>Vendor link</strong>
      <input
        readOnly
        value={url}
        aria-label="Vendor link"
        style={{ width: '100%', fontFamily: 'monospace', fontSize: 12 }}
      />
      <div>
        <CopyButton value={url} label="Copy vendor link" />
      </div>
      {emailConfigured() && props.data?.status !== 'cancelled' && props.id !== undefined && (
        <SendInvitationsButton eventId={props.id} waiting={1} action="vendorLink" />
      )}
      <p style={{ margin: 0, fontSize: 12, opacity: 0.75 }}>
        Send this to the vendor. It shows the event, their role, arrival time and your instructions, and
        lets them confirm. It stops working if the booking is cancelled. Amounts are never shown on it.
        When email is set up, a vendor with an email address gets it automatically once booked.
      </p>
    </div>
  )
}
