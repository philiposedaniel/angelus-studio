import { ZipArchive } from 'archiver'
import fs from 'fs'
import path from 'path'
import type { TaskConfig } from 'payload'

import { MAX_PHOTOS_PER_ZIP, ZIP_LIFETIME_MS, zipPath } from '@/collections/GalleryDownloads'
import { openGalleryFile } from '@/lib/galleryFiles'
import { idOf } from '@/lib/ids'
import { GALLERY_ZIPS_DIR } from '@/lib/storage'

/** Gives every file in the archive a unique name, keeping the photographer's filenames. */
const uniqueName = (taken: Set<string>, name: string) => {
  const ext = path.extname(name)
  const base = name.slice(0, name.length - ext.length)
  let candidate = name
  for (let n = 2; taken.has(candidate.toLowerCase()); n++) candidate = `${base}-${n}${ext}`
  taken.add(candidate.toLowerCase())
  return candidate
}

/** Builds the ZIP for one gallery download request, outside any web request. */
export const buildGalleryZip: TaskConfig<{ input: { downloadId: number }; output: object }> = {
  slug: 'build-gallery-zip',
  label: 'Build gallery ZIP',
  inputSchema: [{ name: 'downloadId', type: 'number', required: true }],
  retries: 2,
  handler: async ({ input, req }) => {
    const { payload } = req
    const download = await payload.findByID({
      collection: 'gallery-downloads',
      id: input.downloadId,
      depth: 0,
      req,
    })
    await payload.update({ collection: 'gallery-downloads', id: download.id, data: { status: 'processing' }, req })

    try {
      const galleryId = idOf(download.gallery)
      let photoIds: (number | string)[] | undefined
      if (download.scope === 'favorites') {
        const favorites = await payload.find({
          collection: 'gallery-favorites',
          where: { and: [{ gallery: { equals: galleryId } }, { user: { equals: idOf(download.user) } }] },
          depth: 0,
          pagination: false,
          req,
        })
        photoIds = favorites.docs.map((f) => idOf(f.photo)!).filter((id) => id !== undefined)
      }
      const photos = await payload.find({
        collection: 'gallery-photos',
        where: {
          and: [
            { gallery: { equals: galleryId } },
            ...(photoIds ? [{ id: { in: photoIds.length ? photoIds : [0] } }] : []),
          ],
        },
        sort: 'sortOrder',
        depth: 0,
        limit: MAX_PHOTOS_PER_ZIP,
        req,
      })

      await fs.promises.mkdir(GALLERY_ZIPS_DIR, { recursive: true })
      const target = zipPath(download.id)
      const partial = `${target}.part`
      const output = fs.createWriteStream(partial)
      // Photos are already compressed; storing them avoids wasting CPU on recompression.
      const archive = new ZipArchive({ store: true })
      const done = new Promise<void>((resolve, reject) => {
        output.on('close', resolve)
        output.on('error', reject)
        archive.on('error', reject)
      })
      archive.pipe(output)
      const names = new Set<string>()
      for (const photo of photos.docs) {
        if (!photo.filename) continue
        archive.append(await openGalleryFile(photo.filename), { name: uniqueName(names, photo.filename) })
      }
      await archive.finalize()
      await done
      await fs.promises.rename(partial, target)
      const { size } = await fs.promises.stat(target)

      await payload.update({
        collection: 'gallery-downloads',
        id: download.id,
        data: {
          status: 'ready',
          sizeBytes: size,
          photoCount: photos.docs.length,
          expiresAt: new Date(Date.now() + ZIP_LIFETIME_MS).toISOString(),
          error: null,
        },
        req,
      })
    } catch (error) {
      await payload.update({
        collection: 'gallery-downloads',
        id: download.id,
        data: { status: 'failed', error: (error as Error).message.slice(0, 500) },
        req,
      })
      throw error
    }
    return { output: {} }
  },
}

/** Deletes expired ZIP files so temporary downloads do not fill the disk. */
export const cleanupGalleryZips: TaskConfig<{ input: object; output: { removed: number } }> = {
  slug: 'cleanup-gallery-zips',
  label: 'Delete expired gallery ZIPs',
  schedule: [{ cron: '0 * * * *', queue: 'default' }],
  handler: async ({ req }) => {
    const { payload } = req
    const expired = await payload.find({
      collection: 'gallery-downloads',
      where: {
        and: [{ status: { equals: 'ready' } }, { expiresAt: { less_than: new Date().toISOString() } }],
      },
      depth: 0,
      pagination: false,
      req,
    })
    for (const download of expired.docs) {
      await fs.promises.rm(zipPath(download.id), { force: true })
      await payload.update({ collection: 'gallery-downloads', id: download.id, data: { status: 'expired' }, req })
    }
    return { output: { removed: expired.docs.length } }
  },
}
