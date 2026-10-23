import config from '@payload-config'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getPayload } from 'payload'

import { RegistrationForm } from '@/components/tickets/RegistrationForm'

import { getDictionary } from '@/i18n/dictionaries'
import { getPublishedEvent } from '@/lib/events'
import { resolveLocale } from '@/lib/locale'
import { parseVideoUrl } from '@/lib/embeds'
import { issueFormToken } from '@/lib/inquiries'
import { formatMoney } from '@/lib/money'
import { getCurrentTenant } from '@/lib/tenant'
import { ticketOffers, type TicketOffer } from '@/lib/tickets'
import { refreshWaitlist } from '@/lib/waitlist'
import { eventHasPromoCodes } from '@/lib/promoCodes'

import { formatEventWhen } from '@/lib/eventTime'

export async function generateMetadata({ params }: PageProps<'/[locale]/events/[slug]'>) {
  const tenant = await getCurrentTenant()
  if (!tenant) return {}
  const { locale: requested, slug } = await params
  const locale = await resolveLocale(tenant, requested)
  const event = await getPublishedEvent(tenant.id, slug, locale)
  return event ? { title: event.title, description: event.summary ?? undefined } : {}
}

const plural = (forms: { one: string; other: string }, count: number) =>
  (count === 1 ? forms.one : forms.other).replace('{count}', String(count))

/** One event: when and where, its summary, its tickets and its live stream if it has one. */
export default async function EventPage({
  params,
  searchParams,
}: PageProps<'/[locale]/events/[slug]'>) {
  const tenant = await getCurrentTenant()
  if (!tenant) notFound()
  const { locale: requested, slug } = await params
  const locale = await resolveLocale(tenant, requested)
  const event = await getPublishedEvent(tenant.id, slug, locale)
  if (!event) notFound()
  const t = getDictionary(locale).events
  const live = parseVideoUrl(event.livestreamUrl)
  const tt = getDictionary(locale).tickets
  const price = (offer: TicketOffer) =>
    offer.price > 0 ? formatMoney(offer.price, offer.currency, locale) : tt.free
  const payload = await getPayload({ config })
  const offers = await ticketOffers(payload, event, locale, undefined, (id, now) =>
    refreshWaitlist(payload, id, { now }),
  )
  const bookable = offers.filter((offer) => offer.state === 'onSale')
  const promoCodes =
    bookable.some((offer) => offer.price > 0) && (await eventHasPromoCodes(payload, event.id))
  const soldOut = offers.filter((offer) => offer.state === 'soldOut')
  const formOffer = (offer: TicketOffer) => ({
    id: offer.id,
    name: offer.name,
    left: offer.left,
    maxPerOrder: offer.maxPerOrder,
    price: offer.price,
    priceLabel: price(offer),
  })
  const paymentCancelled = (await searchParams).payment === 'cancelled'
  const availability = (offer: TicketOffer) => {
    if (offer.state === 'onSale') return plural(tt.placesLeft, offer.left)
    if (offer.state === 'soldOut') {
      return offer.waiting > 0
        ? `${tt.soldOut} · ${plural(tt.waitlist.peopleWaiting, offer.waiting)}`
        : tt.soldOut
    }
    if (offer.state === 'notYet' && offer.salesStart) {
      const date = new Intl.DateTimeFormat(locale, {
        dateStyle: 'long',
        timeStyle: 'short',
        timeZone: event.timeZone || 'Europe/Lisbon',
      }).format(new Date(offer.salesStart))
      return tt.notYet.replace('{date}', date)
    }
    return offer.state === 'ended' ? tt.ended : tt.closed
  }

  return (
    <div className="mx-auto grid max-w-4xl gap-8 px-6 py-16 text-ivory">
      <Link href={`/${locale}/events`} className="text-mist underline">
        {t.backToEvents}
      </Link>
      <header className="grid gap-3">
        <h1 className="font-serif text-4xl">{event.title}</h1>
        <p>
          <span className="text-mist">{t.when}: </span>
          {formatEventWhen(event, locale)}
        </p>
        {event.location && (
          <p>
            <span className="text-mist">{t.where}: </span>
            {event.location}
          </p>
        )}
        <a
          href={`/${locale}/events/${event.slug}/calendar`}
          download
          className="w-fit text-gold underline"
        >
          {t.addToCalendar}
        </a>
      </header>
      {event.summary && <p className="whitespace-pre-line text-ivory/90">{event.summary}</p>}
      {offers.length > 0 && (
        <section id="tickets" className="grid gap-6">
          <h2 className="font-serif text-2xl">{tt.heading}</h2>
          <ul className="grid gap-3">
            {offers.map((offer) => (
              <li
                key={offer.id}
                className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-ivory/10 bg-charcoal p-5"
              >
                <div className="grid gap-1">
                  <span className="font-medium">{offer.name}</span>
                  {offer.description && (
                    <span className="text-sm text-mist">{offer.description}</span>
                  )}
                </div>
                <div className="grid justify-items-end gap-1 text-sm">
                  <span className="text-gold">{price(offer)}</span>
                  <span className="text-mist">{availability(offer)}</span>
                </div>
              </li>
            ))}
          </ul>
          {paymentCancelled && (
            <p role="status" className="rounded-xl border border-gold/40 p-4 text-sm">
              {tt.paymentCancelled}
            </p>
          )}
          {bookable.length > 0 && (
            <div className="grid gap-4 rounded-xl border border-ivory/10 p-6">
              <h3 className="font-serif text-xl">{tt.register}</h3>
              <RegistrationForm
                eventId={event.id}
                locale={locale}
                formToken={issueFormToken(tenant.id)}
                offers={bookable.map(formOffer)}
                t={tt}
                promoCodes={promoCodes}
              />
            </div>
          )}
          {soldOut.length > 0 && (
            <div className="grid gap-4 rounded-xl border border-ivory/10 p-6">
              <h3 className="font-serif text-xl">{tt.waitlist.heading}</h3>
              <p className="text-sm text-mist">{tt.waitlist.intro}</p>
              <RegistrationForm
                eventId={event.id}
                locale={locale}
                formToken={issueFormToken(tenant.id)}
                offers={soldOut.map(formOffer)}
                t={tt}
                waitlist
              />
            </div>
          )}
        </section>
      )}
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
    </div>
  )
}
