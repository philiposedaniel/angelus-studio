import config from '@payload-config'
import { notFound } from 'next/navigation'
import { getPayload } from 'payload'

import { InvitationShell } from '@/components/invite/InvitationShell'
import { getDictionary } from '@/i18n/dictionaries'
import { getSessionUser } from '@/lib/auth'
import { idOf, parseRowId } from '@/lib/ids'
import { canPreviewInvitation } from '@/lib/invitationDesign'
import { resolveLocale } from '@/lib/locale'
import { getCurrentTenant } from '@/lib/tenant'

export const metadata = { robots: { index: false }, referrer: 'no-referrer' }

/**
 * An event's invitation as guests see it, for the studio staff designing it. Only staff who may
 * edit the event, signed in on this studio's site, get it; everyone else gets a 404.
 */
export default async function InvitationPreviewPage({ params }: PageProps<'/[locale]/invite/preview/[event]'>) {
  const tenant = await getCurrentTenant()
  if (!tenant) notFound()
  const { locale: requested, event: eventId } = await params
  const locale = await resolveLocale(tenant, requested)
  if (parseRowId(eventId) === null) notFound()

  const user = await getSessionUser()
  if (!canPreviewInvitation(user, tenant.id)) notFound()

  const payload = await getPayload({ config })
  const event = await payload
    .findByID({ collection: 'events', id: eventId, depth: 1, locale, user, overrideAccess: false })
    .catch(() => null)
  if (!event || String(idOf(event.tenant)) !== String(tenant.id)) notFound()

  const t = getDictionary(locale).invite
  return (
    <>
      <p role="note" className="mx-auto mt-6 max-w-2xl rounded-lg border border-gold/40 px-4 py-3 text-sm text-gold">
        {t.previewNote}
      </p>
      <InvitationShell event={event} locale={locale} t={t}>
        <section className="grid gap-2">
          <p>
            {t.dear} {t.sampleGuest},
          </p>
          <p className="text-mist">{t.seats.one}</p>
        </section>
        <section className="grid gap-4 rounded-xl border border-ivory/10 bg-charcoal p-6">
          <h2 className="font-serif text-2xl">{t.yourReply}</h2>
          <p className="text-mist">{t.previewReply}</p>
        </section>
      </InvitationShell>
    </>
  )
}
