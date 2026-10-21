import fs from 'fs'
import path from 'path'
import { Readable } from 'stream'

import { objectStore, SIGNED_URL_SECONDS, objectStorageEnabled } from '@/lib/objectStorage'
import { GALLERY_PHOTOS_DIR } from '@/lib/storage'

/**
 * Where a gallery photo's files live. Payload writes uploads into GALLERY_PHOTOS_DIR first; with object
 * storage on, the files then move to the bucket and the local copies are removed. Reads go to whichever
 * place holds the files, so the rest of the app does not need to know which one is on.
 */

export type PhotoFile = { filename: string; mimeType?: string | null }

const objectKey = (filename: string) => `gallery-photos/${path.basename(filename)}`
const localPath = (filename: string) => path.join(GALLERY_PHOTOS_DIR, path.basename(filename))

/** Moves a photo's files from the upload folder to object storage, then removes the local copies. */
export async function moveFilesToObjectStorage(files: PhotoFile[]) {
  const store = objectStore()
  for (const file of files) {
    const body = await fs.promises.readFile(localPath(file.filename))
    await store.put(objectKey(file.filename), body, file.mimeType || 'application/octet-stream')
  }
  for (const file of files) await fs.promises.rm(localPath(file.filename), { force: true })
}

/** Deletes a photo's files from object storage. Used when a photo is deleted or its file replaced. */
export async function deleteObjectStorageFiles(filenames: string[]) {
  const store = objectStore()
  for (const filename of filenames) await store.delete(objectKey(filename))
}

/** The bytes of one stored file (an original or a copy). */
export async function readGalleryFile(filename: string): Promise<Buffer> {
  return streamToBuffer(await openGalleryFile(filename))
}

/** A readable stream of one stored file, from object storage or the local folder. */
export async function openGalleryFile(filename: string): Promise<Readable> {
  if (objectStorageEnabled()) return objectStore().get(objectKey(filename))
  return fs.createReadStream(localPath(filename))
}

/** A short-lived link to one stored file. Only meaningful with object storage on. */
export function signedGalleryFileUrl(filename: string): Promise<string> {
  return objectStore().signedUrl(objectKey(filename), SIGNED_URL_SECONDS)
}

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  return Buffer.concat(chunks)
}
