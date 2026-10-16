import config from '@payload-config'
import { notFound } from 'next/navigation'
import { getPayload } from 'payload'

import { RsvpForm } from '@/components/invite/RsvpForm'
import { getDictionary } from '@/i18n/dictionaries'
import { parseVideoUrl } from '@/lib/embeds'
import { formatEventWhen } from '@/lib/eventTime'
import { resolveLocale } from '@/lib/locale'
import { findInvitation, rsvpIsOpen } from '@/lib/rsvp'
import { isShareToken } from '@/lib/shareTokens'
import { getCurrentTenant } from '@/lib/tenant'

// The link is the guest's personal key: keep it out of search engines and referrers.
export const metadata = { robots: { index: false }, referrer: 'no-referrer' }

const plural = (forms: { one: string; other: string }, count: number) =>
  (count === 1 ? forms.one : forms.other).replace('{count}', String(count))

/** A guest's personal invitation: the event, and their reply for their party. */
export default async function InvitationPage({ params }: PageProps<'/[locale]/invite/[token]'>) {
  const tenant = await getCurrentTenant()
  if (!tenant) notFound()
  const { locale: requested, token } = await params
  const locale = await resolveLocale(tenant, requested)
  if (!isShareToken(token)) notFound()

  const payload = await getPayload({ config })
  const found = await findInvitation(payload, tenant.id, token)
  if (!found) notFound()
  const { guest } = found
  // Read again in the guest's language; the lookup above used the default one.
  const event = await payload.findByID({
    collection: 'events',
    id: found.event.id,
    depth: 0,
    locale,
    overrideAccess: true,
  })

  const t = getDictionary(locale).invite
  const partySize = guest.partySize ?? 1
  const open = rsvpIsOpen(event)
  const live = parseVideoUrl(event.livestreamUrl)
  const deadline = event.rsvpDeadline
    ? new Intl.DateTimeFormat(locale, {
        dateStyle: 'long',
        timeStyle: 'short',
        timeZone: event.timeZone || 'Europe/Lisbon',
      }).format(new Date(event.rsvpDeadline))
    : null

  return (
    <main className="mx-auto grid max-w-2xl gap-8 px-6 py-16 text-ivory">
      <header className="grid gap-3">
        <p className="text-sm uppercase tracking-widest text-gold">{t.heading}</p>
        <h1 className="font-serif text-4xl">{event.title}</h1>
        <p>{formatEventWhen(event, locale)}</p>
        {event.location && <p className="text-mist">{event.location}</p>}
      </header>

      <section className="grid gap-2">
        <p>
          {t.dear} {guest.name},
        </p>
        <p className="text-mist">{plural(t.seats, partySize)}</p>
        {event.summary && <p className="whitespace-pre-line text-ivory/90">{event.summary}</p>}
      </section>

      <section className="grid gap-4 rounded-xl border border-ivory/10 bg-charcoal p-6">
        <h2 className="font-serif text-2xl">{t.yourReply}</h2>
        {deadline && open && (
          <p className="text-mist">
            {t.replyBy} {deadline}
          </p>
        )}
        {guest.rsvpStatus === 'attending' && (
          <p role="status">{plural(t.currentAttending, guest.attendingCount ?? 1)}</p>
        )}
        {guest.rsvpStatus === 'declined' && <p role="status">{t.currentDeclined}</p>}
        {open ? (
          <RsvpForm
            token={token}
            partySize={partySize}
            answered={guest.rsvpStatus !== 'pending'}
            initial={{
              response: guest.rsvpStatus === 'pending' ? undefined : (guest.rsvpStatus ?? undefined),
              attendingCount: guest.attendingCount || 1,
              dietaryNotes: guest.dietaryNotes ?? '',
              guestMessage: guest.guestMessage ?? '',
            }}
            t={t}
          />
        ) : (
          <p className="text-mist">{t.closed}</p>
        )}
      </section>

      {live && (
        <section className="grid gap-3">
          <h2 className="font-serif text-2xl">{t.watchLive}</h2>
          <div className="aspect-video w-full overflow-hidden rounded-xl">
            <iframe
              src={live.src}
              title={event.title}
              loading="lazy"
              allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
              allowFullScreen
              referrerPolicy="strict-origin-when-cross-origin"
              className="h-full w-full border-0"
            />
          </div>
        </section>
      )}

      {event.gallery && event.guestToken && (
        <a
          href={`/${locale}/events/${event.slug}/guests/${event.guestToken}`}
          className="w-fit rounded-full border border-gold px-6 py-3 text-gold hover:bg-gold hover:text-ink"
        >
          {t.openAlbum}
        </a>
      )}
    </main>
  )
}
