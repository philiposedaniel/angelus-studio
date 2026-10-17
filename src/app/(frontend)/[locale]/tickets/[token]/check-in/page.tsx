import config from '@payload-config'
import { notFound } from 'next/navigation'
import { getPayload } from 'payload'

import { CheckInForm } from '@/components/invite/CheckInForm'
import { getDictionary } from '@/i18n/dictionaries'
import { getSessionUser } from '@/lib/auth'
import { canCheckIn } from '@/lib/checkIn'
import { formatEventWhen } from '@/lib/eventTime'
import { resolveLocale } from '@/lib/locale'
import { isShareToken } from '@/lib/shareTokens'
import { getCurrentTenant } from '@/lib/tenant'
import { findTicket } from '@/lib/tickets'

import { checkInTicketAction } from './actions'

export const metadata = { robots: { index: false }, referrer: 'no-referrer' }

const plural = (forms: { one: string; other: string }, count: number) =>
  (count === 1 ? forms.one : forms.other).replace('{count}', String(count))

/**
 * Where a ticket's entry code leads. Studio staff signed in on this site see the registration and
 * check it in; anyone else is told to show the code at the entrance, and learns nothing more.
 */
export default async function TicketCheckInPage({ params }: PageProps<'/[locale]/tickets/[token]/check-in'>) {
  const tenant = await getCurrentTenant()
  if (!tenant) notFound()
  const { locale: requested, token } = await params
  const locale = await resolveLocale(tenant, requested)
  if (!isShareToken(token)) notFound()

  const payload = await getPayload({ config })
  const found = await findTicket(payload, tenant.id, token, locale)
  if (!found) notFound()
  const dictionary = getDictionary(locale)
  const t = dictionary.checkIn
  const user = await getSessionUser()

  if (!canCheckIn(user, tenant.id)) {
    const back = `/${locale}/tickets/${token}/check-in`
    return (
      <main className="mx-auto grid max-w-xl gap-6 px-6 py-16 text-ivory">
        <h1 className="font-serif text-3xl">{t.showAtEntrance}</h1>
        <p className="text-mist">{t.staffOnly}</p>
        <a href={`/admin/login?redirect=${encodeURIComponent(back)}`} className="text-sm text-mist underline">
          {t.staffSignIn}
        </a>
      </main>
    )
  }

  const { registration, event, ticketType } = found
  const quantity = registration.quantity ?? 1
  const arrived = registration.checkedInCount ?? 0
  const time = new Intl.DateTimeFormat(locale, { timeStyle: 'short', timeZone: event.timeZone || 'Europe/Lisbon' })

  return (
    <main className="mx-auto grid max-w-xl gap-6 px-6 py-12 text-ivory">
      <header className="grid gap-1">
        <p className="text-sm uppercase tracking-widest text-gold">{t.heading}</p>
        <p className="text-mist">
          {event.title} · {formatEventWhen(event, locale)}
        </p>
      </header>
      <section className="grid gap-2 rounded-xl border border-ivory/10 bg-charcoal p-6">
        <h1 className="font-serif text-3xl">{registration.name}</h1>
        <p>{ticketType.name}</p>
        <p>{plural(dictionary.tickets.admits, quantity)}</p>
        {arrived > 0 && registration.checkedInAt && (
          <p role="status" className="text-gold">
            {plural(t.alreadyIn, arrived).replace('{time}', time.format(new Date(registration.checkedInAt)))}
          </p>
        )}
      </section>
      {registration.status === 'confirmed' ? (
        <CheckInForm
          token={token}
          partySize={quantity}
          initialCount={arrived || quantity}
          checkedIn={arrived > 0}
          t={t}
          saveAction={checkInTicketAction}
        />
      ) : (
        <p role="alert" className="text-xl text-copper">
          {dictionary.tickets.doNotAdmit}
        </p>
      )}
    </main>
  )
}
