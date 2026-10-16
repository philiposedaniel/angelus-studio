import config from '@payload-config'
import { notFound } from 'next/navigation'
import { getPayload } from 'payload'

import { CheckInForm } from '@/components/invite/CheckInForm'
import { getDictionary } from '@/i18n/dictionaries'
import { getSessionUser } from '@/lib/auth'
import { canCheckIn } from '@/lib/checkIn'
import { formatEventWhen } from '@/lib/eventTime'
import { resolveLocale } from '@/lib/locale'
import { findInvitation } from '@/lib/rsvp'
import { isShareToken } from '@/lib/shareTokens'
import { getCurrentTenant } from '@/lib/tenant'

export const metadata = { robots: { index: false }, referrer: 'no-referrer' }

const plural = (forms: { one: string; other: string }, count: number) =>
  (count === 1 ? forms.one : forms.other).replace('{count}', String(count))

/**
 * Where the code on an invitation leads. Studio staff signed in on this site see the guest and
 * check them in; anyone else is told to show the code at the entrance, and learns nothing more.
 */
export default async function CheckInPage({ params }: PageProps<'/[locale]/invite/[token]/check-in'>) {
  const tenant = await getCurrentTenant()
  if (!tenant) notFound()
  const { locale: requested, token } = await params
  const locale = await resolveLocale(tenant, requested)
  if (!isShareToken(token)) notFound()

  const payload = await getPayload({ config })
  const found = await findInvitation(payload, tenant.id, token)
  if (!found) notFound()
  const t = getDictionary(locale).checkIn
  const user = await getSessionUser()

  if (!canCheckIn(user, tenant.id)) {
    const back = `/${locale}/invite/${token}/check-in`
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

  const { guest, event } = found
  const partySize = guest.partySize ?? 1
  const arrived = guest.checkedInCount ?? 0
  const time = new Intl.DateTimeFormat(locale, { timeStyle: 'short', timeZone: event.timeZone || 'Europe/Lisbon' })
  const rsvp =
    guest.rsvpStatus === 'attending'
      ? plural(t.rsvpAttending, guest.attendingCount ?? 1)
      : guest.rsvpStatus === 'declined'
        ? t.rsvpDeclined
        : t.rsvpPending

  return (
    <main className="mx-auto grid max-w-xl gap-6 px-6 py-12 text-ivory">
      <header className="grid gap-1">
        <p className="text-sm uppercase tracking-widest text-gold">{t.heading}</p>
        <p className="text-mist">
          {event.title} · {formatEventWhen(event, locale)}
        </p>
      </header>
      <section className="grid gap-2 rounded-xl border border-ivory/10 bg-charcoal p-6">
        <h1 className="font-serif text-3xl">{guest.name}</h1>
        {guest.group && <p className="text-mist">{guest.group}</p>}
        <p>{plural(t.seats, partySize)}</p>
        <p>{rsvp}</p>
        {guest.dietaryNotes && (
          <p>
            <span className="text-mist">{t.dietary}: </span>
            {guest.dietaryNotes}
          </p>
        )}
        {arrived > 0 && guest.checkedInAt && (
          <p role="status" className="text-gold">
            {plural(t.alreadyIn, arrived).replace('{time}', time.format(new Date(guest.checkedInAt)))}
          </p>
        )}
      </section>
      <CheckInForm
        token={token}
        partySize={partySize}
        initialCount={arrived || Math.min(guest.attendingCount || partySize, partySize)}
        checkedIn={arrived > 0}
        t={t}
      />
    </main>
  )
}
