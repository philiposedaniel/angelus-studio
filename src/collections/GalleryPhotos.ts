import type { CollectionConfig, PayloadRequest } from 'payload'

import { galleryRead, galleryStaff, isGalleryStaffFor } from '@/access/galleries'
import { deleteObjectStorageFiles, moveFilesToObjectStorage, photoFiles, readGalleryFile, signedGalleryFileUrl } from '@/lib/galleryFiles'
import { idOf } from '@/lib/ids'
import { objectStorageEnabled } from '@/lib/objectStorage'
import { GALLERY_PHOTOS_DIR } from '@/lib/storage'
import { watermarkImage } from '@/lib/watermark'

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

/**
 * Clients and album viewers get the preview copies of a gallery with a watermark when the
 * gallery has one. Staff see clean copies. Originals are left to `guardOriginalDownload`.
 */
async function watermarkViewingCopy(
  req: PayloadRequest,
  { doc, params }: { doc: unknown; params: { filename: string } },
): Promise<Response | undefined> {
  const photo = doc as {
    filename?: string | null
    gallery?: unknown
    tenant?: unknown
    sizes?: Record<string, { filename?: string | null } | undefined>
  }
  if (params.filename === photo.filename) return undefined
  if (isGalleryStaffFor(req.user, idOf(photo.tenant))) return undefined
  const isCopy = Object.values(photo.sizes ?? {}).some((copy) => copy?.filename === params.filename)
  const galleryId = idOf(photo.gallery)
  if (!isCopy || galleryId === undefined) return undefined
  const gallery = await req.payload.findByID({
    collection: 'galleries',
    id: galleryId,
    depth: 0,
    req,
    overrideAccess: true,
  })
  if (!gallery.watermarkText) return undefined

  const marked = await watermarkImage(await readGalleryFile(params.filename), gallery.watermarkText)
  return new Response(new Uint8Array(marked), {
    headers: {
      'Content-Type': 'image/webp',
      'Content-Length': String(marked.length),
      'Cache-Control': 'private, max-age=300',
    },
  })
}

/**
 * Serves one file of a photo after Payload has checked that the requester can read the photo.
 * Originals go only to those allowed to download them, and copies are watermarked when the gallery
 * asks. With object storage on, everything else is a link to the stored file that lasts a few minutes,
 * and the link is never cached. Without it, Payload serves the local file itself.
 */
export async function serveGalleryFile(
  req: PayloadRequest,
  args: { doc: unknown; params: { filename: string } },
): Promise<Response | undefined> {
  const denied = await guardOriginalDownload(req, args)
  if (denied) return denied
  const marked = await watermarkViewingCopy(req, args)
  if (marked) return marked
  if (!objectStorageEnabled()) return undefined
  return new Response(null, {
    status: 302,
    headers: {
      Location: await signedGalleryFileUrl(args.params.filename),
      'Cache-Control': 'private, no-store',
      'X-Robots-Tag': 'noindex',
    },
  })
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
    // Payload's type wants a Response promise; resolving to undefined lets Payload serve the local file.
    handlers: [(req, args) => serveGalleryFile(req, args) as Promise<Response>],
  },
  hooks: {
    afterChange: [
      // With object storage on, the files Payload just wrote locally move to the bucket. A new file
      // replaces the old one, whose stored copies are then removed.
      async ({ doc, previousDoc }) => {
        if (!objectStorageEnabled()) return doc
        if (previousDoc && previousDoc.filename === doc.filename) return doc
        await moveFilesToObjectStorage(photoFiles(doc))
        if (previousDoc) await deleteObjectStorageFiles(photoFiles(previousDoc).map((file) => file.filename))
        return doc
      },
    ],
    afterDelete: [
      async ({ doc }) => {
        if (objectStorageEnabled()) await deleteObjectStorageFiles(photoFiles(doc).map((file) => file.filename))
      },
    ],
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
