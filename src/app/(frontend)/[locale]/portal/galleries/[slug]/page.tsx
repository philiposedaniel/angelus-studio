import config from '@payload-config'
import { ArrowLeft, Download, Maximize2 } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getPayload } from 'payload'

import { FavoriteButton } from '@/components/portal/FavoriteButton'
import { getDictionary } from '@/i18n/dictionaries'
import { requirePortalUser } from '@/lib/auth'
import { cn } from '@/lib/cn'
import { resolveLocale } from '@/lib/locale'
import { getCurrentTenant } from '@/lib/tenant'

export const metadata = { robots: { index: false } }

/** Large galleries are paged; virtualised scrolling can come later. */
const PAGE_SIZE = 200

export default async function GalleryPage({
  params,
  searchParams,
}: PageProps<'/[locale]/portal/galleries/[slug]'>) {
  const tenant = await getCurrentTenant()
  if (!tenant) notFound()
  const { locale: requested, slug } = await params
  const locale = await resolveLocale(tenant, requested)
  const user = await requirePortalUser(tenant, locale)
  const t = getDictionary(locale).portal
  const query = await searchParams
  const onlyFavorites = query.view === 'favorites'
  const page = Math.max(1, Number(query.page) || 1)
  const payload = await getPayload({ config })

  const { docs } = await payload.find({
    collection: 'galleries',
    user,
    overrideAccess: false,
    where: { and: [{ tenant: { equals: tenant.id } }, { slug: { equals: slug } }] },
    limit: 1,
    depth: 0,
    locale,
  })
  const gallery = docs[0]
  if (!gallery) notFound()

  const favorites = await payload.find({
    collection: 'gallery-favorites',
    user,
    overrideAccess: false,
    where: { and: [{ gallery: { equals: gallery.id } }, { user: { equals: user.id } }] },
    depth: 0,
    limit: 0,
    pagination: false,
  })
  const favoriteByPhoto = new Map(
    favorites.docs.map((f) => [typeof f.photo === 'object' ? f.photo.id : f.photo, f.id]),
  )

  const favoriteIds = [...favoriteByPhoto.keys()]
  const photos = await payload.find({
    collection: 'gallery-photos',
    user,
    overrideAccess: false,
    where: {
      and: [
        { gallery: { equals: gallery.id } },
        // `in` with no ids would match nothing in SQL but is rejected by some adapters.
        ...(onlyFavorites ? [{ id: { in: favoriteIds.length ? favoriteIds : [0] } }] : []),
      ],
    },
    sort: 'sortOrder',
    depth: 0,
    limit: PAGE_SIZE,
    page,
    locale,
  })

  const base = `/${locale}/portal/galleries/${gallery.slug}`
  const tab = (active: boolean) =>
    cn(
      'rounded-full px-4 py-2 text-sm transition-colors',
      active ? 'bg-gold text-ink' : 'border border-ivory/20 text-mist hover:text-gold',
    )

  return (
    <section className="mx-auto max-w-7xl px-4 py-16 sm:px-8">
      <Link
        href={`/${locale}/portal`}
        className="inline-flex items-center gap-2 text-sm text-mist transition-colors hover:text-gold"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        {t.backToGalleries}
      </Link>
      <h1 className="font-display mt-6 text-4xl sm:text-5xl">{gallery.title}</h1>
      {gallery.description && <p className="mt-4 max-w-3xl text-mist">{gallery.description}</p>}

      <nav aria-label={t.favorites} className="mt-8 flex gap-3">
        <Link href={base} className={tab(!onlyFavorites)} aria-current={!onlyFavorites ? 'page' : undefined}>
          {t.showAll}
        </Link>
        <Link
          href={`${base}?view=favorites`}
          className={tab(onlyFavorites)}
          aria-current={onlyFavorites ? 'page' : undefined}
        >
          {t.favorites} ({favoriteByPhoto.size})
        </Link>
      </nav>

      {photos.docs.length === 0 ? (
        <p className="mt-10 text-mist">{t.emptyGallery}</p>
      ) : (
        <ul className="mt-10 columns-2 gap-4 sm:columns-3 lg:columns-4">
          {photos.docs.map((photo) => (
            <li key={photo.id} className="group relative mb-4 break-inside-avoid overflow-hidden rounded-xl bg-graphite">
              {/* Private files are served with the visitor's session, so no image optimizer. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={photo.sizes?.thumbnail?.url ?? photo.url ?? ''}
                alt={photo.alt ?? ''}
                width={photo.sizes?.thumbnail?.width ?? photo.width ?? undefined}
                height={photo.sizes?.thumbnail?.height ?? photo.height ?? undefined}
                loading="lazy"
                className="h-auto w-full"
              />
              <div className="absolute top-2 right-2 flex gap-2">
                <FavoriteButton
                  photoId={photo.id}
                  initialFavoriteId={favoriteByPhoto.get(photo.id) ?? null}
                  labels={{ favorite: t.favorite, unfavorite: t.unfavorite, error: t.favoriteError }}
                />
              </div>
              <div className="absolute right-2 bottom-2 flex gap-2 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100">
                <a
                  href={photo.sizes?.web?.url ?? photo.url ?? '#'}
                  target="_blank"
                  rel="noopener"
                  aria-label={t.viewLarge}
                  title={t.viewLarge}
                  className="flex size-10 items-center justify-center rounded-full bg-ink/70 text-ivory backdrop-blur hover:text-gold"
                >
                  <Maximize2 aria-hidden="true" className="size-5" />
                </a>
                {gallery.allowDownloads && photo.url && (
                  <a
                    href={photo.url}
                    download={photo.filename ?? true}
                    aria-label={t.downloadOriginal}
                    title={t.downloadOriginal}
                    className="flex size-10 items-center justify-center rounded-full bg-ink/70 text-ivory backdrop-blur hover:text-gold"
                  >
                    <Download aria-hidden="true" className="size-5" />
                  </a>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {photos.totalPages > 1 && (
        <nav className="mt-10 flex gap-3" aria-label="Pages">
          {Array.from({ length: photos.totalPages }, (_, i) => i + 1).map((n) => (
            <Link
              key={n}
              href={`${base}?${new URLSearchParams({ ...(onlyFavorites ? { view: 'favorites' } : {}), page: String(n) })}`}
              className={tab(n === page)}
              aria-current={n === page ? 'page' : undefined}
            >
              {n}
            </Link>
          ))}
        </nav>
      )}
    </section>
  )
}
