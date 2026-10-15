import path from 'path'
import type { CollectionConfig, PayloadRequest } from 'payload'

import { galleryRead, galleryStaff, isGalleryStaffFor } from '@/access/galleries'

/**
 * Where private originals and their resized copies are stored on disk. It is outside
 * `public/` and files are only served through Payload's file route, which checks read
 * access for every request. Production should move this to private object storage.
 */
export const PRIVATE_MEDIA_DIR = path.resolve(
  process.env.PRIVATE_MEDIA_DIR || path.join(process.cwd(), 'private-media'),
  'gallery-photos',
)

const forbidden = () =>
  Response.json({ errors: [{ message: 'You are not allowed to download this file.' }] }, { status: 403 })

const idOf = (value: unknown): number | string | undefined =>
  value && typeof value === 'object' && 'id' in value
    ? (value as { id: number | string }).id
    : (value as number | string | undefined)

/**
 * Clients may view the resized copies of photos they can see, but only download the
 * full-resolution original when the gallery allows downloads. Staff always can.
 */
async function guardOriginalDownload(
  req: PayloadRequest,
  { doc, params }: { doc: unknown; params: { filename: string } },
): Promise<Response | undefined> {
  const photo = doc as { filename?: string; gallery?: unknown; tenant?: unknown }
  if (params.filename !== photo.filename) return undefined
  if (isGalleryStaffFor(req.user, idOf(photo.tenant))) return undefined
  const galleryId = idOf(photo.gallery)
  if (galleryId === undefined) return forbidden()
  const gallery = await req.payload.findByID({
    collection: 'galleries',
    id: galleryId,
    depth: 0,
    req,
    overrideAccess: true,
  })
  return gallery.allowDownloads ? undefined : forbidden()
}

export const GalleryPhotos: CollectionConfig = {
  slug: 'gallery-photos',
  labels: { singular: 'Gallery photo', plural: 'Gallery photos' },
  admin: {
    useAsTitle: 'filename',
    defaultColumns: ['filename', 'gallery', 'sortOrder', 'updatedAt'],
    group: 'Client delivery',
  },
  defaultSort: 'sortOrder',
  access: {
    read: galleryRead('gallery.'),
    create: galleryStaff,
    update: galleryStaff,
    delete: galleryStaff,
  },
  fields: [
    {
      name: 'gallery',
      type: 'relationship',
      relationTo: 'galleries',
      required: true,
      index: true,
    },
    { name: 'alt', type: 'text', localized: true },
    { name: 'sortOrder', type: 'number', defaultValue: 0, index: true },
  ],
  upload: {
    staticDir: PRIVATE_MEDIA_DIR,
    mimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/tiff'],
    // Originals are kept untouched; these copies are for fast viewing.
    imageSizes: [
      { name: 'thumbnail', width: 480, formatOptions: { format: 'webp', options: { quality: 80 } } },
      { name: 'web', width: 1920, formatOptions: { format: 'webp', options: { quality: 85 } } },
    ],
    adminThumbnail: 'thumbnail',
    focalPoint: false,
    crop: false,
    // Read access has already been checked by Payload when this runs.
    // Payload's type wants a Response promise; resolving to undefined lets the file through.
    handlers: [(req, args) => guardOriginalDownload(req, args) as Promise<Response>],
  },
  hooks: {
    beforeValidate: [
      // A photo always belongs to the same studio as its gallery.
      async ({ data, req }) => {
        const galleryId = idOf(data?.gallery)
        if (!data || galleryId === undefined) return data
        const gallery = await req.payload.findByID({
          collection: 'galleries',
          id: galleryId,
          depth: 0,
          req,
          overrideAccess: true,
        })
        data.tenant = idOf(gallery.tenant)
        return data
      },
    ],
  },
}
