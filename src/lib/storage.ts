import path from 'path'

/**
 * Root folder for private client files (never inside public/). Production mounts it as a
 * Docker volume; it will move to private object storage later.
 */
export const PRIVATE_MEDIA_ROOT = path.resolve(
  process.env.PRIVATE_MEDIA_DIR || path.join(process.cwd(), 'private-media'),
)

export const GALLERY_PHOTOS_DIR = path.join(PRIVATE_MEDIA_ROOT, 'gallery-photos')

/** Temporary ZIP archives built for client downloads; deleted when they expire. */
export const GALLERY_ZIPS_DIR = path.join(PRIVATE_MEDIA_ROOT, 'gallery-zips')
