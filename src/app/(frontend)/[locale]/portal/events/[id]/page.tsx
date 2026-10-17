import config from '@payload-config'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getPayload } from 'payload'

import { CopyLinkButton } from '@/components/portal/CopyLinkButton'
import { GuestForm } from '@/components/portal/GuestForm'
import { RemoveGuestButton } from '@/components/portal/RemoveGuestButton'
import { LOCALE_LABELS } from '@/i18n/config'
import { getDictionary } from '@/i18n/dictionaries'
import { requirePortalUser } from '@/lib/auth'
import { formatEventWhen } from '@/lib/eventTime'
import { idOf } from '@/lib/ids'
import { resolveLocale, tenantLocales } from '@/lib/locale'
import { isGuestListStaff, isOrganizerOf } from '@/lib/organizers'
import { summarizeRsvps } from '@/lib/rsvp'
import { siteOrigin } from '@/lib/siteOrigin'
import { getCurrentTenant } from '@/lib/tenant'

export const metadata = { robots: { index: false } }

/** An organizer's guest list for one of their events: who is invited, their replies and links. */
export default async function OrganizerEventPage({
  params,
  searchParams,
}: PageProps<'/[locale]/portal/events/[id]'>) {
  const tenant = await getCurrentTenant()
  if (!tenant) notFound()
  const { locale: requested, id } = await params
  const locale = await resolveLocale(tenant, requested)
  const user = await requirePortalUser(tenant, locale)
  if (!/^\d+$/.test(id)) notFound()

  const payload = await getPayload({ config })
  const event = await payload
    .findByID({ collection: 'events', id, depth: 0, locale, user, overrideAccess: false })
    .catch(() => null)
  if (!event || String(idOf(event.tenant)) !== String(tenant.id)) notFound()
  if (!isOrganizerOf(user, event) && !isGuestListStaff(user, tenant.id)) notFound()

  const { docs: guests } = await payload.find({
    collection: 'event-guests',
    where: { event: { equals: event.id } },
    sort: 'name',
    pagination: false,
    depth: 0,
    user,
    overrideAccess: false,
  })
  const t = getDictionary(locale).organizer
  const offered = tenantLocales(tenant)
  const origin = await siteOrigin(payload, tenant.id)
  const linkFor = (language: string | null | undefined, token: string) =>
    `${origin}/${language && offered.includes(language as never) ? language : offered[0]}/invite/${token}`
  const s = summarizeRsvps(guests)
  const editId = (await searchParams)?.edit
  const editing = guests.find((guest) => String(guest.id) === String(editId))
  const languages = offered.map((value) => ({ value, label: LOCALE_LABELS[value] }))

  return (
    <section className="mx-auto grid max-w-5xl gap-10 px-4 py-16 sm:px-8">
      <header className="grid gap-2">
        <Link href={`/${locale}/portal`} className="text-sm text-mist hover:text-gold">
          ← {t.backToPortal}
        </Link>
        <p className="text-sm uppercase tracking-widest text-gold">{t.guestList}</p>
        <h1 className="font-display text-4xl">{event.title}</h1>
        <p className="text-mist">{formatEventWhen(event, locale)}</p>
      </header>

      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          [t.invitations, String(s.invitations)],
          [t.attending, `${s.attending} (${s.headcount} ${t.people})`],
          [t.declined, String(s.declined)],
          [t.pending, String(s.pending)],
        ].map(([label, value]) => (
          <div key={label} className="rounded-xl border border-ivory/10 bg-charcoal p-4">
            <dt className="text-sm text-mist">{label}</dt>
            <dd className="mt-1 text-xl">{value}</dd>
          </div>
        ))}
      </dl>

      <div className="grid gap-3">
        <p className="text-sm text-mist">{t.linkHelp}</p>
        {guests.length === 0 ? (
          <p className="text-mist">{t.noGuests}</p>
        ) : (
          <ul className="grid gap-3">
            {guests.map((guest) => (
              <li
                key={guest.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-ivory/10 bg-charcoal p-4"
              >
                <div className="grid gap-1">
                  <span className="font-medium">{guest.name}</span>
                  <span className="text-sm text-mist">
                    {[
                      guest.group,
                      `${t.partySize}: ${guest.partySize ?? 1}`,
                      guest.rsvpStatus === 'attending'
                        ? t.replyAttending.replace('{count}', String(guest.attendingCount ?? 1))
                        : guest.rsvpStatus === 'declined'
                          ? t.declined
                          : t.pending,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  {guest.inviteToken && (
                    <CopyLinkButton value={linkFor(guest.language, guest.inviteToken)} label={t.copyLink} copied={t.copied} />
                  )}
                  <Link
                    href={`/${locale}/portal/events/${event.id}?edit=${guest.id}#guest-form`}
                    className="text-sm text-mist underline-offset-4 hover:text-gold hover:underline"
                  >
                    {t.edit}
                  </Link>
                  <RemoveGuestButton eventId={event.id} guestId={guest.id} name={guest.name} t={t} />
                </div>
              </li>
            ))}
          </ul>
        )}
        {guests.length > 0 && (
          <a href={`/api/event-guests/export?event=${event.id}`} download className="w-fit text-sm text-gold underline">
            {t.download}
          </a>
        )}
      </div>

      <div id="guest-form" className="grid gap-4 rounded-xl border border-ivory/10 bg-charcoal p-6">
        <h2 className="font-display text-2xl">{editing ? t.editGuest : t.addGuest}</h2>
        <GuestForm
          key={editing?.id ?? 'new'}
          eventId={event.id}
          languages={languages}
          guest={
            editing
              ? {
                  id: editing.id,
                  name: editing.name,
                  email: editing.email ?? '',
                  phone: editing.phone ?? '',
                  group: editing.group ?? '',
                  partySize: editing.partySize ?? 1,
                  language: editing.language ?? offered[0]!,
                }
              : null
          }
          cancelHref={`/${locale}/portal/events/${event.id}`}
          t={t}
        />
      </div>
    </section>
  )
}
