import config from '@payload-config'
import { notFound } from 'next/navigation'
import { getPayload } from 'payload'

import { ConfirmBookingForm } from '@/components/vendor/ConfirmBookingForm'
import { getDictionary } from '@/i18n/dictionaries'
import { formatEventWhen } from '@/lib/eventTime'
import { resolveLocale } from '@/lib/locale'
import { isShareToken } from '@/lib/shareTokens'
import { getCurrentTenant } from '@/lib/tenant'
import { eventArrivals, findVendorBooking } from '@/lib/vendors'

// The link is the vendor's key: keep it out of search engines and referrers.
export const metadata = { robots: { index: false }, referrer: 'no-referrer' }

/**
 * A vendor's page for one booking: the event, their role and arrival time, the studio's
 * instructions, and a button to confirm. Amounts and staff notes are never shown here.
 */
export default async function VendorBookingPage({ params }: PageProps<'/[locale]/vendor/[token]'>) {
  const tenant = await getCurrentTenant()
  if (!tenant) notFound()
  const { locale: requested, token } = await params
  const locale = await resolveLocale(tenant, requested)
  if (!isShareToken(token)) notFound()

  const payload = await getPayload({ config })
  const found = await findVendorBooking(payload, tenant.id, token)
  if (!found) notFound()
  const { booking, vendor } = found
  const event = await payload.findByID({
    collection: 'events',
    id: found.event.id,
    depth: 0,
    locale,
    overrideAccess: true,
  })
  const t = getDictionary(locale).vendorBooking
  const zone = event.timeZone || 'Europe/Lisbon'
  const arrival = booking.arrivalAt
    ? new Intl.DateTimeFormat(locale, {
        dateStyle: 'full',
        timeStyle: 'short',
        timeZone: zone,
      }).format(new Date(booking.arrivalAt))
    : null
  const confirmed = booking.status === 'confirmed'
  const time = new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: zone,
  })
  const arrivals = await eventArrivals(payload, booking)
  const programme = event.invitation?.schedule ?? []

  return (
    <div className="mx-auto grid max-w-2xl gap-8 px-6 py-16 text-ivory">
      <header className="grid gap-3">
        <p className="text-sm uppercase tracking-widest text-gold">{t.heading}</p>
        <h1 className="font-serif text-4xl">{event.title}</h1>
        <p>{formatEventWhen(event, locale)}</p>
        {event.location && <p className="text-mist">{event.location}</p>}
      </header>

      <dl className="grid gap-4 rounded-xl border border-ivory/10 bg-charcoal p-6">
        <div>
          <dt className="text-sm text-mist">{t.vendor}</dt>
          <dd>{vendor.name}</dd>
        </div>
        <div>
          <dt className="text-sm text-mist">{t.role}</dt>
          <dd>{booking.role}</dd>
        </div>
        {arrival && (
          <div>
            <dt className="text-sm text-mist">{t.arrival}</dt>
            <dd>{arrival}</dd>
          </div>
        )}
        {booking.instructions && (
          <div>
            <dt className="text-sm text-mist">{t.instructions}</dt>
            <dd className="whitespace-pre-line">{booking.instructions}</dd>
          </div>
        )}
      </dl>

      {arrivals.length > 0 && (
        <section className="grid gap-3">
          <h2 className="font-serif text-2xl">{t.arrivals}</h2>
          <p className="text-sm text-mist">{t.arrivalsHelp}</p>
          <ol className="grid gap-2">
            {arrivals.map((row, index) => (
              <li
                key={index}
                className="grid grid-cols-[8rem_1fr] gap-3 border-t border-ivory/10 pt-2"
              >
                <span className="text-gold">
                  {row.arrivalAt ? time.format(new Date(row.arrivalAt)) : t.noTime}
                </span>
                <span className={row.you ? 'font-semibold' : undefined}>
                  {row.role}
                  {row.you && ` (${t.you})`}
                </span>
              </li>
            ))}
          </ol>
        </section>
      )}

      {programme.length > 0 && (
        <section className="grid gap-3">
          <h2 className="font-serif text-2xl">{t.programme}</h2>
          <ol className="grid gap-2">
            {programme.map((item, index) => (
              <li
                key={item.id ?? index}
                className="grid grid-cols-[8rem_1fr] gap-3 border-t border-ivory/10 pt-2"
              >
                <span className="text-gold">{item.time}</span>
                <span>
                  {item.title}
                  {item.place && <span className="block text-sm text-mist">{item.place}</span>}
                </span>
              </li>
            ))}
          </ol>
        </section>
      )}

      <a
        href={`/${locale}/vendor/${token}/calendar`}
        download
        className="w-fit text-gold underline"
      >
        {t.addToCalendar}
      </a>

      {confirmed ? (
        <p role="status" className="text-gold">
          {t.alreadyConfirmed}
        </p>
      ) : (
        <ConfirmBookingForm token={token} t={t} />
      )}
    </div>
  )
}
