import { PhotoAlbum } from '@/components/album/PhotoAlbum'

import { loadSharedAlbum } from '../albumData'

/**
 * The album inside another website's page (an iframe). Kept compact; "More photos" and the
 * title open the full album in a new tab. Framing is allowed for this path only (next.config.ts).
 */
export default async function EmbeddedAlbumPage({
  params,
  searchParams,
}: PageProps<'/s/[token]/embed'>) {
  const { token } = await params
  const query = await searchParams
  const { gallery, photos, studioName, t, labels } = await loadSharedAlbum(token, {
    ...query,
    page: '1',
  })
  const albumUrl = `/s/${token}${typeof query.lang === 'string' ? `?lang=${encodeURIComponent(query.lang)}` : ''}`

  return (
    <main className="p-1">
      <header className="flex flex-wrap items-baseline justify-between gap-2 px-2 py-3">
        <a
          href={albumUrl}
          target="_blank"
          rel="noopener"
          className="font-display text-2xl hover:text-gold"
        >
          {gallery.title}
        </a>
        <span className="text-xs text-mist">
          {photos.totalDocs} {t.photos} · {t.sharedBy} {studioName}
        </span>
      </header>
      {photos.photos.length === 0 ? (
        <p className="px-2 text-mist">{t.empty}</p>
      ) : (
        <PhotoAlbum photos={photos.photos} labels={labels} rowHeight={180} />
      )}
      {photos.hasNextPage && (
        <p className="py-4 text-center">
          <a
            href={albumUrl}
            target="_blank"
            rel="noopener"
            className="text-sm text-mist hover:text-gold"
          >
            {t.morePhotos}
          </a>
        </p>
      )}
    </main>
  )
}
