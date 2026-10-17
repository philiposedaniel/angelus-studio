import type { UIFieldServerProps } from 'payload'

import { LOCALE_LABELS } from '@/i18n/config'
import { idOf } from '@/lib/ids'
import { tenantLocales } from '@/lib/locale'
import { siteOrigin } from '@/lib/siteOrigin'

/** Links to the event's invitation as guests see it, with a sample guest, in each site language. */
export async function InvitationPreviewField(props: UIFieldServerProps) {
  const eventId = props.id ?? props.data?.id
  const tenantId = idOf(props.data?.tenant)
  if (eventId === undefined || eventId === null || tenantId === undefined) {
    return <p style={{ margin: '0 0 24px' }}>Save the event to preview its invitation.</p>
  }
  const tenant = await props.payload.findByID({ collection: 'tenants', id: tenantId, depth: 0 }).catch(() => null)
  const offered = tenant ? tenantLocales(tenant) : (['en'] as const)
  const origin = await siteOrigin(props.payload, tenantId)
  return (
    <p style={{ margin: '0 0 24px' }}>
      Preview the invitation (save first to see your latest changes):{' '}
      {offered.map((language, index) => (
        <span key={language}>
          {index > 0 && ' · '}
          <a
            href={`${origin}/${language}/invite/preview/${encodeURIComponent(String(eventId))}`}
            target="_blank"
            rel="noopener"
          >
            {LOCALE_LABELS[language]}
          </a>
        </span>
      ))}
    </p>
  )
}
