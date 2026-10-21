import type { Payload } from 'payload'

import { hasLocalGalleryFile, moveFilesToObjectStorage, photoFiles } from '@/lib/galleryFiles'
import { objectStorageEnabled } from '@/lib/objectStorage'

const PAGE_SIZE = 100

/**
 * Copies gallery photos that were uploaded before object storage was turned on into the bucket, then
 * removes their local copies. A file that is not on the local disk is counted as already stored. Run it
 * after setting S3_BUCKET and before clients use the galleries. Running it again moves nothing.
 */
export async function moveLocalGalleryFilesToStorage(payload: Payload): Promise<{ moved: number; alreadyStored: number }> {
  if (!objectStorageEnabled()) throw new Error('Set S3_BUCKET and the S3 variables before moving files')
  let moved = 0
  let alreadyStored = 0
  // A command-line task, not a request from a user, so the access rules are not applied. It reads every photo
  // and writes only files that are still on the local disk.
  for (let page = 1; ; page++) {
    const result = await payload.find({
      collection: 'gallery-photos',
      depth: 0,
      limit: PAGE_SIZE,
      page,
      overrideAccess: true,
    })
    for (const photo of result.docs) {
      const files = photoFiles(photo)
      const local = files.filter((file) => hasLocalGalleryFile(file.filename))
      alreadyStored += files.length - local.length
      if (local.length === 0) continue
      await moveFilesToObjectStorage(local)
      moved += local.length
    }
    if (!result.hasNextPage) break
  }
  return { moved, alreadyStored }
}
