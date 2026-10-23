import config from '@payload-config'
import fs from 'fs'
import path from 'path'
import { getPayload } from 'payload'
import { Readable } from 'stream'

import { openGalleryFile, readGalleryFile, signedGalleryFileUrl } from '@/lib/galleryFiles'
import { idOf } from '@/lib/ids'
import { objectStorageEnabled } from '@/lib/objectStorage'
import { findSharedGallery } from '@/lib/sharedAlbum'
import { isSharedSize } from '@/lib/shareTokens'
import { GALLERY_PHOTOS_DIR } from '@/lib/storage'
import { getCurrentTenant } from '@/lib/tenant'
import { watermarkImage } from '@/lib/watermark'

const notFound = () => new Response('Not found', { status: 404 })

/** Largest Postgres integer id. A bigger id fails in the query, so it is not found here. Switch to src/lib/ids.ts once #64 is on main. */
const MAX_ROW_ID = 2147483647

/** Serves a web-size copy of a photo in a shared album. Never the original. */
export async function GET(
  _request: Request,
  { params }: RouteContext<'/s/[token]/p/[photoId]/[size]'>,
) {
  const { token, photoId, size } = await params
  if (!isSharedSize(size) || !/^\d+$/.test(photoId) || Number(photoId) > MAX_ROW_ID) return notFound()
  const tenant = await getCurrentTenant()
  if (!tenant) return notFound()
  const gallery = await findSharedGallery(tenant, token)
  if (!gallery) return notFound()

  const payload = await getPayload({ config })
  const photo = await payload
    .findByID({ collection: 'gallery-photos', id: Number(photoId), depth: 0 })
    .catch(() => null)
  if (!photo || String(idOf(photo.gallery)) !== String(gallery.id)) return notFound()

  // Photos uploaded before every copy was always generated may lack a web copy.
  const copy = photo.sizes?.[size]?.filename ? photo.sizes[size] : photo.sizes?.thumbnail
  if (!copy?.filename) return notFound()

  const headers = {
    'Content-Type': copy.mimeType ?? 'image/webp',
    // Short, private caching so revoking a link takes effect quickly.
    'Cache-Control': 'private, max-age=300',
    'X-Robots-Tag': 'noindex',
  }
  if (gallery.watermarkText) {
    const marked = await watermarkImage(await readGalleryFile(copy.filename), gallery.watermarkText)
    return new Response(new Uint8Array(marked), {
      headers: { ...headers, 'Content-Type': 'image/webp', 'Content-Length': String(marked.length) },
    })
  }

  if (objectStorageEnabled()) {
    // The stored copy is private, so the browser gets a link that works for a few minutes. Never cached,
    // so a revoked share takes effect on the next request.
    return new Response(null, {
      status: 302,
      headers: { Location: await signedGalleryFileUrl(copy.filename), 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex' },
    })
  }

  const file = path.join(GALLERY_PHOTOS_DIR, path.basename(copy.filename))
  const stats = await fs.promises.stat(file).catch(() => null)
  if (!stats) return notFound()
  return new Response(Readable.toWeb(await openGalleryFile(copy.filename)) as ReadableStream, {
    headers: { ...headers, 'Content-Length': String(stats.size) },
  })
}
