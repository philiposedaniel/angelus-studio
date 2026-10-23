import config from '@payload-config'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getPayload } from 'payload'

import { WaitlistActions } from '@/components/tickets/WaitlistActions'
import { getDictionary } from '@/i18n/dictionaries'
import { formatEventWhen } from '@/lib/eventTime'
import { idOf } from '@/lib/ids'
import { resolveLocale } from '@/lib/locale'
import { formatMoney } from '@/lib/money'
import { isShareToken } from '@/lib/shareTokens'
import { getCurrentTenant } from '@/lib/tenant'
import { canSell } from '@/lib/tickets'
import { findWaitlistEntry, offerOpen, refreshWaitlist, waitlistPosition } from '@/lib/waitlist'

// The link lets its holder claim places: keep it out of search engines and referrers.
export const metadata = { robots: { index: false }, referrer: 'no-referrer' }

const plural = (forms: { one: string; other: string }, count: number) =>
  (count === 1 ? forms.one : forms.other).replace('{count}', String(count))

/** Someone's place on a waitlist: where they stand, and the places held for them when offered. */
export default async function WaitlistPage({ params }: PageProps<'/[locale]/waitlist/[token]'>) {
  const tenant = await getCurrentTenant()
  if (!tenant) notFound()
  const { locale: requested, token } = await params
  const locale = await resolveLocale(tenant, requested)
  if (!isShareToken(token)) notFound()

  const payload = await getPayload({ config })
  const first = await findWaitlistEntry(payload, tenant.id, token, locale)
  if (!first) notFound()
  // Offers and holds run out with time: bring the queue up to date before showing where they stand.
  await refreshWaitlist(payload, first.ticketType.id)
  const found = await findWaitlistEntry(payload, tenant.id, token, locale)
  if (!found) notFound()
  const { entry, event, ticketType } = found
  const t = getDictionary(locale).tickets
  const w = t.waitlist
  const quantity = entry.quantity ?? 1
  const price = ticketType.price ?? 0
  const offered = offerOpen(entry)
  const active = entry.status === 'waiting' || offered
  const until = entry.offerExpiresAt
    ? new Intl.DateTimeFormat(locale, {
        dateStyle: 'long',
        timeStyle: 'short',
        timeZone: event.timeZone || 'Europe/Lisbon',
      }).format(new Date(entry.offerExpiresAt))
    : ''
  const registration =
    entry.status === 'claimed' && idOf(entry.registration) !== undefined
      ? await payload
          .findByID({
            collection: 'registrations',
            id: idOf(entry.registration)!,
            depth: 0,
            overrideAccess: true,
          })
          .catch(() => null)
      : null

  let message: string | null = null
  if (entry.status === 'waiting')
    message = w.position.replace('{position}', String(await waitlistPosition(payload, entry)))
  else if (offered) message = w.offered.replace('{date}', until)
  else if (entry.status === 'claimed') message = w.claimed
  else if (entry.status === 'left') message = w.left
  else if (entry.status === 'removed') message = w.removed
  else message = w.expired

  return (
    <div className="mx-auto grid max-w-xl gap-8 px-6 py-16 text-ivory">
      <header className="grid gap-2">
        <p className="text-sm uppercase tracking-widest text-gold">{w.yourPlace}</p>
        <h1 className="font-serif text-4xl">{event.title}</h1>
        <p className="text-mist">{formatEventWhen(event, locale)}</p>
        {event.location && <p className="text-mist">{event.location}</p>}
      </header>
      <section className="grid gap-2 rounded-xl border border-ivory/10 bg-charcoal p-6">
        <p className="font-serif text-2xl">{entry.name}</p>
        <p>
          {ticketType.name} ·{' '}
          {price > 0
            ? t.perPlace.replace(
                '{price}',
                formatMoney(price, ticketType.currency ?? 'eur', locale),
              )
            : t.free}
        </p>
        <p className="text-mist">{plural(w.asked, quantity)}</p>
      </section>
      <section className="grid gap-4">
        <p role="status" className={offered ? 'text-xl text-gold' : 'text-xl'}>
          {message}
        </p>
        {entry.status === 'waiting' && <p className="text-sm text-mist">{w.waitingHelp}</p>}
        {registration?.ticketToken && (
          <Link
            href={`/${locale}/tickets/${registration.ticketToken}`}
            className="text-gold underline"
          >
            {w.openTicket}
          </Link>
        )}
        {active && (
          <WaitlistActions
            token={token}
            locale={locale}
            offered={offered && canSell(ticketType)}
            paid={price > 0}
            t={w}
          />
        )}
      </section>
    </div>
  )
}
