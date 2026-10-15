import fs from 'fs'
import path from 'path'
import { Readable } from 'stream'
import { APIError, type CollectionConfig, type PayloadHandler, type Where } from 'payload'

import { GALLERY_STAFF_ROLES, isGalleryStaffFor } from '@/access/galleries'
import { isSuperAdmin, tenantIdsWithRole } from '@/access/roles'
import { idOf } from '@/lib/ids'
import { GALLERY_ZIPS_DIR } from '@/lib/storage'

/** Largest number of photos in one ZIP; bigger galleries are downloaded in parts later. */
export const MAX_PHOTOS_PER_ZIP = 2000
/** How long a finished ZIP stays downloadable. */
export const ZIP_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000

export const zipPath = (downloadId: number | string) =>
  path.join(GALLERY_ZIPS_DIR, `${String(downloadId).replace(/[^\w-]/g, '')}.zip`)

const downloadFile: PayloadHandler = async (req) => {
  if (!req.user) return Response.json({ errors: [{ message: 'Sign in first.' }] }, { status: 401 })
  const id = req.routeParams?.id as string
  const download = await req.payload
    .findByID({ collection: 'gallery-downloads', id, depth: 0, req, user: req.user, overrideAccess: false })
    .catch(() => null)
  if (!download) return Response.json({ errors: [{ message: 'Not found.' }] }, { status: 404 })
  const expired = download.expiresAt && new Date(download.expiresAt) < new Date()
  if (download.status !== 'ready' || expired) {
    return Response.json({ errors: [{ message: 'This download is not available.' }] }, { status: 410 })
  }
  const file = zipPath(download.id)
  const stats = await fs.promises.stat(file).catch(() => null)
  if (!stats) return Response.json({ errors: [{ message: 'This download is not available.' }] }, { status: 410 })

  const name = (download.fileName || 'gallery.zip').replace(/[^\w.-]/g, '_')
  return new Response(Readable.toWeb(fs.createReadStream(file)) as ReadableStream, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Length': String(stats.size),
      'Content-Disposition': `attachment; filename="${name}"`,
      'Cache-Control': 'private, no-store',
    },
  })
}

/**
 * A client's request to download a whole gallery (or their favorites) as one ZIP.
 * The ZIP is built by a background job, never inside the web request, and expires after a week.
 */
export const GalleryDownloads: CollectionConfig = {
  slug: 'gallery-downloads',
  labels: { singular: 'Gallery download', plural: 'Gallery downloads' },
  admin: {
    defaultColumns: ['gallery', 'user', 'scope', 'status', 'createdAt'],
    group: 'Client delivery',
  },
  access: {
    read: ({ req: { user } }) => {
      if (!user) return false
      if (isSuperAdmin(user)) return true
      const own: Where = { user: { equals: user.id } }
      const staff = tenantIdsWithRole(user, GALLERY_STAFF_ROLES)
      return staff.length ? { or: [own, { tenant: { in: staff } }] } : own
    },
    // Anyone signed in may ask; the hook checks they can see the gallery and download it.
    create: ({ req: { user } }) => Boolean(user),
    update: () => false,
    delete: ({ req: { user } }) => isSuperAdmin(user),
  },
  endpoints: [{ path: '/:id/file', method: 'get', handler: downloadFile }],
  hooks: {
    beforeValidate: [
      async ({ data, operation, req }) => {
        if (operation !== 'create' || !data) return data
        // Requests made by the system (jobs, seeds) are trusted as given.
        if (req.payloadAPI === 'local' && !req.user) return data
        const user = req.user
        if (!user) throw new APIError('Sign in first.', 401)

        const galleryId = idOf(data.gallery)
        const gallery =
          galleryId === undefined
            ? null
            : await req.payload
                .findByID({ collection: 'galleries', id: galleryId, depth: 0, req, user, overrideAccess: false })
                .catch(() => null)
        if (!gallery) throw new APIError('Gallery not found.', 404)

        const tenantId = idOf(gallery.tenant)
        if (!gallery.allowDownloads && !isGalleryStaffFor(user, tenantId)) {
          throw new APIError('Downloads are not enabled for this gallery.', 403)
        }

        const active = await req.payload.count({
          collection: 'gallery-downloads',
          where: {
            and: [{ user: { equals: user.id } }, { status: { in: ['queued', 'processing'] } }],
          },
          req,
        })
        if (active.totalDocs > 0) {
          throw new APIError('Your previous download is still being prepared.', 429)
        }

        const scope = data.scope === 'favorites' ? 'favorites' : 'all'
        const photoCount =
          scope === 'favorites'
            ? (
                await req.payload.count({
                  collection: 'gallery-favorites',
                  where: { and: [{ gallery: { equals: gallery.id } }, { user: { equals: user.id } }] },
                  req,
                })
              ).totalDocs
            : (
                await req.payload.count({
                  collection: 'gallery-photos',
                  where: { gallery: { equals: gallery.id } },
                  req,
                })
              ).totalDocs
        if (photoCount === 0) throw new APIError('There are no photos to download.', 400)
        if (photoCount > MAX_PHOTOS_PER_ZIP) {
          throw new APIError(`Downloads are limited to ${MAX_PHOTOS_PER_ZIP} photos at a time.`, 400)
        }

        return {
          gallery: gallery.id,
          scope,
          user: user.id,
          tenant: tenantId,
          status: 'queued',
          photoCount,
          fileName: `${gallery.slug}${scope === 'favorites' ? '-favorites' : ''}.zip`,
        }
      },
    ],
    afterChange: [
      async ({ doc, operation, req }) => {
        if (operation !== 'create') return
        await req.payload.jobs.queue({ task: 'build-gallery-zip', input: { downloadId: doc.id }, req })
      },
    ],
  },
  fields: [
    { name: 'user', type: 'relationship', relationTo: 'users', required: true, index: true },
    { name: 'gallery', type: 'relationship', relationTo: 'galleries', required: true, index: true },
    {
      name: 'scope',
      type: 'select',
      required: true,
      defaultValue: 'all',
      options: [
        { label: 'Whole gallery', value: 'all' },
        { label: 'Favorites only', value: 'favorites' },
      ],
    },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'queued',
      index: true,
      options: ['queued', 'processing', 'ready', 'failed', 'expired'].map((value) => ({
        label: value[0]!.toUpperCase() + value.slice(1),
        value,
      })),
    },
    { name: 'photoCount', type: 'number' },
    { name: 'fileName', type: 'text' },
    { name: 'sizeBytes', type: 'number' },
    { name: 'expiresAt', type: 'date', index: true },
    { name: 'error', type: 'text' },
  ],
}
