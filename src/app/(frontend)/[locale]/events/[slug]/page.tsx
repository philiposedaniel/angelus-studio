import Link from 'next/link'
import { notFound } from 'next/navigation'

import { getDictionary } from '@/i18n/dictionaries'
import { getPublishedEvent } from '@/lib/events'
import { resolveLocale } from '@/lib/locale'
import { parseVideoUrl } from '@/lib/embeds'
import { getCurrentTenant } from '@/lib/tenant'

import { formatEventWhen } from '@/lib/eventTime'

export async function generateMetadata({ params }: PageProps<'/[locale]/events/[slug]'>) {
  const tenant = await getCurrentTenant()
  if (!tenant) return {}
  const { locale: requested, slug } = await params
  const locale = await resolveLocale(tenant, requested)
  const event = await getPublishedEvent(tenant.id, slug, locale)
  return event ? { title: event.title, description: event.summary ?? undefined } : {}
}

/** One event: when and where, its summary, and its live stream if it has one. */
export default async function EventPage({ params }: PageProps<'/[locale]/events/[slug]'>) {
  const tenant = await getCurrentTenant()
  if (!tenant) notFound()
  const { locale: requested, slug } = await params
  const locale = await resolveLocale(tenant, requested)
  const event = await getPublishedEvent(tenant.id, slug, locale)
  if (!event) notFound()
  const t = getDictionary(locale).events
  const live = parseVideoUrl(event.livestreamUrl)

  return (
    <main className="mx-auto grid max-w-4xl gap-8 px-6 py-16 text-ivory">
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
      </header>
      {event.summary && <p className="whitespace-pre-line text-ivory/90">{event.summary}</p>}
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
    </main>
  )
}
