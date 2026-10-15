import type { CollectionConfig, PayloadRequest } from 'payload'

import { galleryRead, galleryStaff, isGalleryStaffFor } from '@/access/galleries'
import { idOf } from '@/lib/ids'
import { GALLERY_PHOTOS_DIR } from '@/lib/storage'

const forbidden = () =>
  Response.json({ errors: [{ message: 'You are not allowed to download this file.' }] }, { status: 403 })

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
    // Outside public/; files are only served through Payload's access-checked file route.
    staticDir: GALLERY_PHOTOS_DIR,
    mimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/tiff'],
    // Originals are kept untouched; these copies are for fast viewing.
    // Each copy fits inside a square box, so portrait and landscape photos get the same
    // treatment, and is always generated: smaller originals are kept at their own size.
    imageSizes: [
      {
        name: 'thumbnail',
        width: 720,
        height: 720,
        fit: 'inside',
        withoutEnlargement: true,
        formatOptions: { format: 'webp', options: { quality: 80 } },
      },
      {
        name: 'web',
        width: 1920,
        height: 1920,
        fit: 'inside',
        withoutEnlargement: true,
        formatOptions: { format: 'webp', options: { quality: 85 } },
      },
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
