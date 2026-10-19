import config from '@payload-config'
import { Images } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getPayload } from 'payload'

import { SignOutButton } from '@/components/portal/SignOutButton'
import { getDictionary } from '@/i18n/dictionaries'
import { requirePortalUser } from '@/lib/auth'
import { formatEventWhen } from '@/lib/eventTime'
import { resolveLocale } from '@/lib/locale'
import { getCurrentTenant } from '@/lib/tenant'

export const metadata = { robots: { index: false } }

export default async function PortalHome({ params }: PageProps<'/[locale]/portal'>) {
  const tenant = await getCurrentTenant()
  if (!tenant) notFound()
  const locale = await resolveLocale(tenant, (await params).locale)
  const user = await requirePortalUser(tenant, locale)
  const t = getDictionary(locale).portal
  const payload = await getPayload({ config })

  // Access rules limit this to galleries the user may see (assigned, published, not expired).
  const { docs: galleries } = await payload.find({
    collection: 'galleries',
    user,
    overrideAccess: false,
    where: { and: [{ tenant: { equals: tenant.id } }, { status: { equals: 'published' } }] },
    sort: '-updatedAt',
    depth: 0,
    limit: 100,
    locale,
  })

  // Events this user organizes, whose guest lists they manage here.
  const { docs: organized } = await payload.find({
    collection: 'events',
    user,
    overrideAccess: false,
    where: { and: [{ tenant: { equals: tenant.id } }, { organizers: { in: [user.id] } }] },
    sort: 'startsAt',
    depth: 0,
    limit: 50,
    locale,
  })
  const o = getDictionary(locale).organizer

  const cards = await Promise.all(
    galleries.map(async (gallery) => {
      const photos = await payload.find({
        collection: 'gallery-photos',
        user,
        overrideAccess: false,
        where: { gallery: { equals: gallery.id } },
        sort: 'sortOrder',
        limit: 1,
        depth: 0,
      })
      const cover = photos.docs[0]
      return { gallery, count: photos.totalDocs, cover: cover?.sizes?.thumbnail?.url ?? null }
    }),
  )

  return (
    <section className="mx-auto max-w-7xl px-4 py-20 sm:px-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="font-display text-4xl sm:text-5xl">{t.myGalleries}</h1>
        <div className="flex items-center gap-6">
          <Link href={`/${locale}/portal/calendar`} className="text-gold hover:underline">
            {t.calendarLink}
          </Link>
          <Link href={`/${locale}/portal/security`} className="text-gold hover:underline">
            {t.securityLink}
          </Link>
          <Link href={`/${locale}/portal/projects`} className="text-sm text-gold hover:text-ivory">
            {t.myProjects}
          </Link>
          <SignOutButton label={t.signOut} redirectTo={`/${locale}/portal/login`} />
        </div>
      </div>
      {organized.length > 0 && (
        <div className="mt-10 grid gap-4">
          <h2 className="font-display text-2xl">{o.yourEvents}</h2>
          <ul className="grid gap-3 sm:grid-cols-2">
            {organized.map((event) => (
              <li key={event.id}>
                <Link
                  href={`/${locale}/portal/events/${event.id}`}
                  className="block rounded-2xl border border-ivory/10 bg-charcoal p-5 transition-colors hover:border-gold/50"
                >
                  <span className="block font-display text-xl">{event.title}</span>
                  <span className="mt-1 block text-sm text-mist">
                    {formatEventWhen(event, locale)} · {o.guestList}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
      {cards.length === 0 ? (
        <p className="mt-8 text-mist">{t.noGalleries}</p>
      ) : (
        <ul className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map(({ gallery, count, cover }) => (
            <li key={gallery.id}>
              <Link
                href={`/${locale}/portal/galleries/${gallery.slug}`}
                className="group block overflow-hidden rounded-2xl border border-ivory/10 bg-charcoal transition-colors hover:border-gold/50"
              >
                <div className="relative aspect-[4/3] bg-graphite">
                  {cover ? (
                    // Private files are served with the visitor's session, so no image optimizer.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={cover}
                      alt=""
                      loading="lazy"
                      className="size-full object-cover transition-transform duration-500 group-hover:scale-105"
                    />
                  ) : (
                    <div className="flex size-full items-center justify-center">
                      <Images aria-hidden="true" className="size-10 text-gold/60" />
                    </div>
                  )}
                </div>
                <div className="p-6">
                  <h2 className="font-display text-2xl">{gallery.title}</h2>
                  <p className="mt-2 text-sm text-mist">
                    {count} {t.photos}
                    {gallery.expiresAt &&
                      ` · ${t.availableUntil} ${new Date(gallery.expiresAt).toLocaleDateString(locale)}`}
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
