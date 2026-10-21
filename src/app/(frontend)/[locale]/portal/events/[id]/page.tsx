import config from '@payload-config'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getPayload } from 'payload'

import { CopyLinkButton } from '@/components/portal/CopyLinkButton'
import { GuestForm } from '@/components/portal/GuestForm'
import { GuestImportForm } from '@/components/portal/GuestImportForm'
import { RemoveGuestButton } from '@/components/portal/RemoveGuestButton'
import { LOCALE_LABELS } from '@/i18n/config'
import { getDictionary } from '@/i18n/dictionaries'
import { requirePortalUser } from '@/lib/auth'
import { formatEventWhen } from '@/lib/eventTime'
import { idOf } from '@/lib/ids'
import { resolveLocale, tenantLocales } from '@/lib/locale'
import { isGuestListStaff, isOrganizerOf, ORGANIZER_VENDOR_STATUSES } from '@/lib/organizers'
import { describeParty, eventMealCounts, eventRsvpSummary, summarizeMeals } from '@/lib/rsvp'
import { seatsNeeded, summarizeSeating } from '@/lib/seating'
import { eventTicketSales } from '@/lib/tickets'
import { siteOrigin } from '@/lib/siteOrigin'
import { getCurrentTenant } from '@/lib/tenant'

export const metadata = { robots: { index: false } }

const GUESTS_PER_PAGE = 100

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

  // A page of guests at a time, optionally narrowed by a search, so a list of thousands stays
  // quick to load and to use on a phone. The headcount is added up over the whole list.
  const query = (await searchParams) ?? {}
  const search = typeof query.q === 'string' ? query.q.trim().slice(0, 100) : ''
  const requestedPage = typeof query.page === 'string' && /^\d{1,6}$/.test(query.page) ? Number(query.page) : 1
  const access = { depth: 0, user, overrideAccess: false } as const
  const list = await payload.find({
    collection: 'event-guests',
    where: {
      and: [
        { event: { equals: event.id } },
        ...(search ? [{ or: [{ name: { like: search } }, { email: { like: search } }] }] : []),
      ],
    },
    sort: 'name',
    limit: GUESTS_PER_PAGE,
    page: Math.max(1, requestedPage),
    ...access,
  })
  const guests = list.docs
  const t = getDictionary(locale).organizer
  const offered = tenantLocales(tenant)
  const origin = await siteOrigin(payload, tenant.id)
  const linkFor = (language: string | null | undefined, token: string) =>
    `${origin}/${language && offered.includes(language as never) ? language : offered[0]}/invite/${token}`
  const s = await eventRsvpSummary(payload, event.id)
  const meals = summarizeMeals(event, await eventMealCounts(payload, event.id), s.headcount)
  const mealLabels = new Map(meals.meals.map((meal) => [meal.id, meal.label]))
  const partyOf = (guest: (typeof guests)[number]) =>
    guest.rsvpStatus === 'attending'
      ? describeParty(guest, (mealId) => mealLabels.get(mealId), (n) => t.guestNumber.replace('{n}', String(n)))
      : ''
  const editId = typeof query.edit === 'string' && /^\d+$/.test(query.edit) ? query.edit : null
  const editing = editId
    ? await payload
        .findByID({ collection: 'event-guests', id: editId, ...access })
        .then((guest) => (String(idOf(guest.event)) === String(event.id) ? guest : null))
        .catch(() => null)
    : null
  const pageHref = (page: number) => {
    const params = new URLSearchParams()
    if (search) params.set('q', search)
    if (page > 1) params.set('page', String(page))
    const text = params.toString()
    return `/${locale}/portal/events/${event.id}${text ? `?${text}` : ''}`
  }
  const from = list.totalDocs === 0 ? 0 : (list.page! - 1) * GUESTS_PER_PAGE + 1
  const to = from === 0 ? 0 : from + guests.length - 1
  const languages = offered.map((value) => ({ value, label: LOCALE_LABELS[value] }))

  // Who is working the event and how tickets are selling, read as the organizer: the studio's
  // amounts, notes and the vendors' contact details are not readable by them.
  // The seating plan, read as the organizer: the studio adds the tables, the organizer seats
  // their guests at them. Table notes are the studio's and not readable here.
  const [vendors, ticketTypes, sales, tables, seatedGuests] = await Promise.all([
    payload
      .find({
        collection: 'event-vendors',
        where: { and: [{ event: { equals: event.id } }, { status: { in: [...ORGANIZER_VENDOR_STATUSES] } }] },
        sort: 'arrivalAt',
        pagination: false,
        depth: 1,
        user,
        overrideAccess: false,
      })
      .then((result) => result.docs)
      .catch(() => []),
    payload
      .find({ collection: 'ticket-types', where: { event: { equals: event.id } }, sort: 'sortOrder', pagination: false, locale, ...access })
      .then((result) => result.docs)
      .catch(() => []),
    eventTicketSales(payload, event.id),
    payload
      .find({ collection: 'event-tables', where: { event: { equals: event.id } }, sort: 'sortOrder', pagination: false, ...access })
      .then((result) => result.docs)
      .catch(() => []),
    payload
      .find({
        collection: 'event-guests',
        where: { event: { equals: event.id } },
        sort: 'name',
        pagination: false,
        select: { name: true, table: true, rsvpStatus: true, attendingCount: true, partySize: true },
        ...access,
      })
      .then((result) => result.docs)
      .catch(() => []),
  ])
  const seating = summarizeSeating(tables, seatedGuests)
  const tableName = new Map(tables.map((table) => [String(table.id), table.name]))
  const arrival = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: event.timeZone || 'Europe/Lisbon' })

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

      {meals.meals.length > 0 && (
        <div className="grid gap-2">
          <h2 className="text-sm uppercase tracking-widest text-gold">{t.meals}</h2>
          <ul className="flex flex-wrap gap-3">
            {[...meals.meals.map((meal) => [meal.label, meal.count] as const), ...(meals.notChosen > 0 ? [[t.mealNotChosen, meals.notChosen] as const] : [])].map(
              ([label, count]) => (
                <li key={label} className="rounded-full border border-ivory/10 bg-charcoal px-4 py-2 text-sm">
                  {label}: <span className="font-medium">{count}</span>
                </li>
              ),
            )}
          </ul>
        </div>
      )}

      {ticketTypes.length > 0 && (
        <div className="grid gap-3">
          <h2 className="text-sm uppercase tracking-widest text-gold">{t.tickets}</h2>
          <ul className="grid gap-3 sm:grid-cols-2">
            {ticketTypes.map((ticketType) => {
              const sold = sales.get(String(ticketType.id)) ?? { sold: 0, arrived: 0 }
              return (
                <li key={ticketType.id} className="grid gap-1 rounded-xl border border-ivory/10 bg-charcoal p-4">
                  <span className="font-medium">{ticketType.name}</span>
                  <span className="text-sm text-mist">
                    {t.sold.replace('{sold}', String(sold.sold)).replace('{capacity}', String(ticketType.capacity ?? 0))}
                    {sold.arrived > 0 && ` · ${t.checkedIn.replace('{count}', String(sold.arrived))}`}
                    {ticketType.onSale === false && ` · ${t.notOnSale}`}
                  </span>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {vendors.length > 0 && (
        <div className="grid gap-3">
          <h2 className="text-sm uppercase tracking-widest text-gold">{t.vendors}</h2>
          <p className="text-sm text-mist">{t.vendorsHelp}</p>
          <ul className="grid gap-3 sm:grid-cols-2">
            {vendors.map((booking) => (
              <li key={booking.id} className="grid gap-1 rounded-xl border border-ivory/10 bg-charcoal p-4">
                <span className="font-medium">
                  {typeof booking.vendor === 'object' && booking.vendor ? booking.vendor.name : ''} · {booking.role}
                </span>
                <span className="text-sm text-mist">
                  {booking.arrivalAt ? t.arrives.replace('{time}', arrival.format(new Date(booking.arrivalAt))) : t.noArrival}
                  {' · '}
                  {t.vendorStatus[booking.status as (typeof ORGANIZER_VENDOR_STATUSES)[number]] ?? ''}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {tables.length > 0 && (
        <div className="grid gap-3">
          <h2 className="text-sm uppercase tracking-widest text-gold">{t.seating}</h2>
          <p className="text-sm text-mist">
            {t.seatsTaken.replace('{seated}', String(seating.seated)).replace('{capacity}', String(seating.capacity))}
            {seating.unseatedSeats > 0 && ` · ${t.seatsWithoutTable.replace('{count}', String(seating.unseatedSeats))}`}
          </p>
          <p className="text-sm text-mist">{t.seatingHelp}</p>
          <ul className="grid gap-3 sm:grid-cols-2">
            {seating.tables.map((table) => (
              <li key={table.id} className="grid gap-1 rounded-xl border border-ivory/10 bg-charcoal p-4">
                <span className="font-medium">{table.name}</span>
                <span className={`text-sm ${table.over ? 'text-copper' : 'text-mist'}`}>
                  {t.tableSeats.replace('{seats}', String(table.seats)).replace('{capacity}', String(table.capacity))}
                  {table.over && ` · ${t.overCapacity}`}
                </span>
                {table.guests.some((guest) => seatsNeeded(guest) > 0) && (
                  <span className="text-sm text-mist">
                    {table.guests
                      .filter((guest) => seatsNeeded(guest) > 0)
                      .map((guest) => guest.name)
                      .join(', ')}
                  </span>
                )}
              </li>
            ))}
          </ul>
          <a href={`/api/event-tables/plan?event=${event.id}`} download className="w-fit text-sm text-gold underline">
            {t.downloadSeating}
          </a>
        </div>
      )}

      <div className="grid gap-3">
        <p className="text-sm text-mist">{t.linkHelp}</p>
        {s.invitations > 0 && (
          <form role="search" action={`/${locale}/portal/events/${event.id}`} className="flex flex-wrap items-end gap-3">
            <label className="grid gap-1 text-sm text-mist">
              {t.search}
              <input
                type="search"
                name="q"
                defaultValue={search}
                maxLength={100}
                className="w-72 max-w-full rounded-lg border border-ivory/15 bg-ink px-4 py-3 text-ivory focus:border-gold focus:outline-none"
              />
            </label>
            <button type="submit" className="rounded-full border border-gold px-6 py-3 text-sm font-medium text-gold transition-colors hover:bg-gold hover:text-ink">
              {t.searchButton}
            </button>
            {search && (
              <Link href={`/${locale}/portal/events/${event.id}`} className="min-h-11 content-center text-sm text-mist underline">
                {t.clearSearch}
              </Link>
            )}
          </form>
        )}
        {list.totalDocs > 0 && (
          <p className="text-sm text-mist" aria-live="polite">
            {t.showing
              .replace('{from}', String(from))
              .replace('{to}', String(to))
              .replace('{total}', String(list.totalDocs))}
          </p>
        )}
        {guests.length === 0 ? (
          <p className="text-mist">{search ? t.noMatches : t.noGuests}</p>
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
                      tableName.get(String(idOf(guest.table))),
                      guest.rsvpStatus === 'attending'
                        ? t.replyAttending.replace('{count}', String(guest.attendingCount ?? 1))
                        : guest.rsvpStatus === 'declined'
                          ? t.declined
                          : t.pending,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                  {partyOf(guest) && <span className="text-sm text-mist">{partyOf(guest)}</span>}
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
        {list.totalPages > 1 && (
          <nav aria-label={t.pages} className="flex flex-wrap items-center gap-4 text-sm">
            {list.hasPrevPage && list.prevPage && (
              <Link href={pageHref(list.prevPage)} rel="prev" className="min-h-11 content-center text-gold underline">
                ← {t.previousPage}
              </Link>
            )}
            <span className="text-mist">
              {t.pageOf.replace('{page}', String(list.page)).replace('{pages}', String(list.totalPages))}
            </span>
            {list.hasNextPage && list.nextPage && (
              <Link href={pageHref(list.nextPage)} rel="next" className="min-h-11 content-center text-gold underline">
                {t.nextPage} →
              </Link>
            )}
          </nav>
        )}
        {s.invitations > 0 && (
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
          tables={tables.map((table) => ({ value: String(table.id), label: table.name }))}
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
                  table: editing.table ? String(idOf(editing.table)) : '',
                }
              : null
          }
          cancelHref={`/${locale}/portal/events/${event.id}`}
          t={t}
        />
      </div>

      <div className="grid gap-4 rounded-xl border border-ivory/10 bg-charcoal p-6">
        <h2 className="font-display text-2xl">{t.import.title}</h2>
        <GuestImportForm eventId={event.id} t={t.import} />
      </div>
    </section>
  )
}
