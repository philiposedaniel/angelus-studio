import type { Metadata } from 'next'
import Link from 'next/link'

import { PhotoAlbum } from '@/components/album/PhotoAlbum'

import { loadSharedAlbum } from './albumData'

export async function generateMetadata({
  params,
  searchParams,
}: PageProps<'/s/[token]'>): Promise<Metadata> {
  const { gallery, studioName } = await loadSharedAlbum((await params).token, await searchParams)
  return { title: `${gallery.title} | ${studioName}` }
}

/** A shared album, opened from its link: like a Google Photos shared album. */
export default async function SharedAlbumPage({ params, searchParams }: PageProps<'/s/[token]'>) {
  const { token } = await params
  const query = await searchParams
  const { gallery, photos, page, locale, studioName, t, labels } = await loadSharedAlbum(
    token,
    query,
  )
  const next = new URLSearchParams({
    ...(typeof query.lang === 'string' ? { lang: locale } : {}),
    page: String(page + 1),
  })

  return (
    <main className="px-1 pb-12 sm:px-2">
      <header className="mx-auto max-w-7xl px-3 pt-10 pb-8 sm:px-6">
        <p className="text-sm tracking-widest text-gold uppercase">
          {t.sharedBy}{' '}
          <Link href="/" className="hover:underline">
            {studioName}
          </Link>
        </p>
        <h1 className="font-display mt-3 text-4xl sm:text-5xl">{gallery.title}</h1>
        {gallery.description && <p className="mt-3 max-w-3xl text-mist">{gallery.description}</p>}
        <p className="mt-3 text-sm text-mist">
          {photos.totalDocs} {t.photos}
        </p>
      </header>
      {photos.photos.length === 0 ? (
        <p className="mx-auto max-w-7xl px-3 text-mist sm:px-6">{t.empty}</p>
      ) : (
        <PhotoAlbum photos={photos.photos} labels={labels} />
      )}
      {photos.hasNextPage && (
        <div className="mt-8 text-center">
          <Link
            href={`/s/${token}?${next}`}
            className="inline-flex rounded-full border border-ivory/20 px-5 py-2 text-sm text-mist hover:text-gold"
          >
            {t.morePhotos}
          </Link>
        </div>
      )}
    </main>
  )
}
