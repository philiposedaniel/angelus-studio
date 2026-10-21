import Link from 'next/link'
import { notFound } from 'next/navigation'

import { getDictionary } from '@/i18n/dictionaries'
import { listPublishedEvents } from '@/lib/events'
import { resolveLocale } from '@/lib/locale'
import { getCurrentTenant } from '@/lib/tenant'

import { formatEventWhen } from '@/lib/eventTime'

/** The studio's published events, soonest first. */
export default async function EventsPage({ params }: PageProps<'/[locale]/events'>) {
  const tenant = await getCurrentTenant()
  if (!tenant) notFound()
  const locale = await resolveLocale(tenant, (await params).locale)
  const t = getDictionary(locale).events
  const events = await listPublishedEvents(tenant.id, locale)

  return (
    <div className="mx-auto grid max-w-4xl gap-8 px-6 py-16 text-ivory">
      <h1 className="font-serif text-4xl">{t.heading}</h1>
      {events.length === 0 && <p className="text-mist">{t.noEvents}</p>}
      <ul className="grid gap-6">
        {events.map((event) => (
          <li key={event.id} className="border-b border-ivory/10 pb-6">
            <Link href={`/${locale}/events/${event.slug}`} className="grid gap-1">
              <span className="font-serif text-2xl">{event.title}</span>
              <span className="text-mist">{formatEventWhen(event, locale)}</span>
              {event.location && <span className="text-mist">{event.location}</span>}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
