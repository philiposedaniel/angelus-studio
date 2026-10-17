import config from '@payload-config'
import { notFound } from 'next/navigation'
import { getPayload } from 'payload'
import QRCode from 'qrcode'

import { getDictionary } from '@/i18n/dictionaries'
import { formatEventWhen } from '@/lib/eventTime'
import { resolveLocale } from '@/lib/locale'
import { isShareToken } from '@/lib/shareTokens'
import { siteOrigin } from '@/lib/siteOrigin'
import { getCurrentTenant } from '@/lib/tenant'
import { findTicket } from '@/lib/tickets'

// The link is the person's ticket: keep it out of search engines and referrers.
export const metadata = { robots: { index: false }, referrer: 'no-referrer' }

const plural = (forms: { one: string; other: string }, count: number) =>
  (count === 1 ? forms.one : forms.other).replace('{count}', String(count))

/** A registration's ticket: the event, the places it admits and the entry code staff scan. */
export default async function TicketPage({ params }: PageProps<'/[locale]/tickets/[token]'>) {
  const tenant = await getCurrentTenant()
  if (!tenant) notFound()
  const { locale: requested, token } = await params
  const locale = await resolveLocale(tenant, requested)
  if (!isShareToken(token)) notFound()

  const payload = await getPayload({ config })
  const found = await findTicket(payload, tenant.id, token, locale)
  if (!found) notFound()
  const { registration, event, ticketType } = found
  const t = getDictionary(locale).tickets
  const quantity = registration.quantity ?? 1
  const confirmed = registration.status === 'confirmed'
  const arrived = registration.checkedInCount ?? 0

  // The entry code opens the ticket's check-in page, which only the studio's staff can use.
  const entryCode = confirmed
    ? await QRCode.toString(`${await siteOrigin(payload, tenant.id)}/${locale}/tickets/${token}/check-in`, {
        type: 'svg',
        margin: 1,
        errorCorrectionLevel: 'M',
      })
    : null

  return (
    <main className="mx-auto grid max-w-xl gap-8 px-6 py-16 text-ivory">
      <header className="grid gap-2">
        <p className="text-sm uppercase tracking-widest text-gold">{t.yourTicket}</p>
        <h1 className="font-serif text-4xl">{event.title}</h1>
        <p className="text-mist">{formatEventWhen(event, locale)}</p>
        {event.location && <p className="text-mist">{event.location}</p>}
      </header>
      <section className="grid gap-2 rounded-xl border border-ivory/10 bg-charcoal p-6">
        <p className="font-serif text-2xl">{registration.name}</p>
        <p>
          {ticketType.name} · {t.free}
        </p>
        <p className="text-mist">{plural(t.admits, quantity)}</p>
        {arrived > 0 && <p className="text-gold">{plural(t.checkedIn, arrived)}</p>}
      </section>
      {confirmed ? (
        <>
          <section className="grid gap-3">
            <h2 className="font-serif text-2xl">{t.entryCode}</h2>
            <div
              role="img"
              aria-label={t.entryCode}
              className="w-56 rounded-xl bg-white p-3"
              // An SVG drawn by the QR library from our own link; it holds no visitor input.
              dangerouslySetInnerHTML={{ __html: entryCode ?? '' }}
            />
            <p className="text-sm text-mist">{t.entryCodeHelp}</p>
          </section>
          <p className="rounded-xl border border-gold/40 p-4 text-sm">{t.keepLink}</p>
        </>
      ) : (
        <p role="status" className="text-copper">
          {t.cancelled}
        </p>
      )}
    </main>
  )
}
