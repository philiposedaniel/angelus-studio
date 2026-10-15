import config from '@payload-config'
import { getPayload } from 'payload'

import type { Gallery, GalleryPhoto, Tenant } from '@/payload-types'

import { isShareToken, type SharedSize } from './shareTokens'

/** Photos per page of a shared album. */
export const SHARED_PAGE_SIZE = 200

/**
 * The gallery a share link points at, if the link is still valid for this studio: sharing is
 * on, the gallery is published and not expired. These are system reads (no signed-in user);
 * the token is the permission, so every condition is checked here explicitly.
 */
export async function findSharedGallery(
  tenant: Tenant,
  token: string,
  locale?: string,
): Promise<Gallery | null> {
  if (!isShareToken(token)) return null
  const payload = await getPayload({ config })
  const { docs } = await payload.find({
    collection: 'galleries',
    where: {
      and: [
        { tenant: { equals: tenant.id } },
        { shareToken: { equals: token } },
        { shareEnabled: { equals: true } },
        { status: { equals: 'published' } },
        {
          or: [
            { expiresAt: { exists: false } },
            { expiresAt: { greater_than: new Date().toISOString() } },
          ],
        },
      ],
    },
    limit: 1,
    depth: 0,
    locale: locale as never,
  })
  return docs[0] ?? null
}

/** What a shared album exposes about a photo: web-size copies only, through the share link. */
export type SharedPhoto = {
  id: number
  alt: string
  thumb: { src: string; width: number; height: number }
  large: { src: string; width: number; height: number }
}

export const sharedPhotoUrl = (token: string, photoId: number | string, size: SharedSize) =>
  `/s/${token}/p/${photoId}/${size}`

export const toSharedPhoto = (token: string, photo: GalleryPhoto): SharedPhoto => {
  const thumb = photo.sizes?.thumbnail
  const web = photo.sizes?.web
  const width = web?.width ?? photo.width ?? 1
  const height = web?.height ?? photo.height ?? 1
  return {
    id: photo.id,
    alt: photo.alt ?? '',
    thumb: {
      src: sharedPhotoUrl(token, photo.id, 'thumbnail'),
      width: thumb?.width ?? width,
      height: thumb?.height ?? height,
    },
    large: { src: sharedPhotoUrl(token, photo.id, 'web'), width, height },
  }
}

export async function findSharedPhotos(
  gallery: Gallery,
  token: string,
  page: number,
  locale?: string,
) {
  const payload = await getPayload({ config })
  const result = await payload.find({
    collection: 'gallery-photos',
    where: { gallery: { equals: gallery.id } },
    sort: 'sortOrder',
    depth: 0,
    limit: SHARED_PAGE_SIZE,
    page,
    locale: locale as never,
  })
  return { ...result, photos: result.docs.map((photo) => toSharedPhoto(token, photo)) }
}
