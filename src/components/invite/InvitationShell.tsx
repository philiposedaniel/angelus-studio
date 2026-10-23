import Image from 'next/image'

import type { Dictionary } from '@/i18n/dictionaries'
import type { Locale } from '@/i18n/config'
import { formatEventWhen } from '@/lib/eventTime'
import { invitationThemeClass } from '@/lib/invitationDesign'
import { mediaSrc } from '@/lib/media'
import type { Event, Media } from '@/payload-types'

const asMedia = (value: unknown): Media | null =>
  value && typeof value === 'object' && 'url' in value ? (value as Media) : null

/**
 * An event's invitation in the design chosen on the event: cover, headline, message, programme,
 * dress code and map. The guest's own part (greeting, reply, entry code) goes in `children`.
 * Read the event with depth 1 so the cover image is populated.
 */
export function InvitationShell({
  event,
  locale,
  t,
  children,
}: {
  event: Event
  locale: Locale
  t: Dictionary['invite']
  children: React.ReactNode
}) {
  const design = event.invitation ?? {}
  const cover = asMedia(design.coverImage)
  const schedule = design.schedule ?? []

  return (
    <div
      className={`${invitationThemeClass(design.style)} mx-auto my-10 max-w-2xl overflow-hidden rounded-2xl`}
    >
      {cover?.url && (
        <div className="relative aspect-[16/9] w-full">
          <Image
            src={mediaSrc(cover.sizes?.card?.url ?? cover.url)}
            alt={cover.alt ?? ''}
            fill
            priority
            sizes="(min-width: 672px) 672px, 100vw"
            className="object-cover"
          />
        </div>
      )}
      <div className="grid gap-8 px-6 py-12 text-ivory sm:px-10">
        <header className="grid gap-3 text-center">
          <p className="text-sm uppercase tracking-widest text-gold">
            {design.headline || t.heading}
          </p>
          <h1 className="font-serif text-4xl">{event.title}</h1>
          <p>{formatEventWhen(event, locale)}</p>
          {event.location && <p className="text-mist">{event.location}</p>}
        </header>

        {design.message && <p className="whitespace-pre-line text-center">{design.message}</p>}

        {schedule.length > 0 && (
          <section className="grid gap-3">
            <h2 className="text-center font-serif text-2xl">{t.programme}</h2>
            <ol className="grid gap-2">
              {schedule.map((item, index) => (
                <li
                  key={item.id ?? index}
                  className="grid grid-cols-[5rem_1fr] gap-3 border-t border-ivory/10 pt-2"
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

        {(design.dressCode || design.mapUrl) && (
          <section className="grid gap-1 text-center">
            {design.dressCode && (
              <p>
                <span className="text-mist">{t.dressCode}: </span>
                {design.dressCode}
              </p>
            )}
            {design.mapUrl && (
              <a
                href={design.mapUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-gold underline"
              >
                {t.openMap}
              </a>
            )}
          </section>
        )}

        {children}

        {design.signature && (
          <p className="text-center font-serif text-xl text-gold">{design.signature}</p>
        )}
      </div>
    </div>
  )
}
