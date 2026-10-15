import config from '@payload-config'
import fs from 'fs'
import path from 'path'
import { getPayload } from 'payload'
import { Readable } from 'stream'

import { idOf } from '@/lib/ids'
import { findSharedGallery } from '@/lib/sharedAlbum'
import { isSharedSize } from '@/lib/shareTokens'
import { GALLERY_PHOTOS_DIR } from '@/lib/storage'
import { getCurrentTenant } from '@/lib/tenant'

const notFound = () => new Response('Not found', { status: 404 })

/** Serves a web-size copy of a photo in a shared album. Never the original. */
export async function GET(
  _request: Request,
  { params }: RouteContext<'/s/[token]/p/[photoId]/[size]'>,
) {
  const { token, photoId, size } = await params
  if (!isSharedSize(size) || !/^\d+$/.test(photoId)) return notFound()
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
  const file = path.join(GALLERY_PHOTOS_DIR, path.basename(copy.filename))
  const stats = await fs.promises.stat(file).catch(() => null)
  if (!stats) return notFound()

  return new Response(Readable.toWeb(fs.createReadStream(file)) as ReadableStream, {
    headers: {
      'Content-Type': copy.mimeType ?? 'image/webp',
      'Content-Length': String(stats.size),
      // Short, private caching so revoking a link takes effect quickly.
      'Cache-Control': 'private, max-age=300',
      'X-Robots-Tag': 'noindex',
    },
  })
}
