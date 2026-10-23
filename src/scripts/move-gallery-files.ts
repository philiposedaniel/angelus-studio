/**
 * Copies gallery photos on the local disk into object storage. Set S3_BUCKET and its variables first.
 * Safe to run more than once. Usage: pnpm storage:move-local
 */
import config from '@payload-config'
import { getPayload } from 'payload'

import { moveLocalGalleryFilesToStorage } from '@/lib/galleryBackfill'

const payload = await getPayload({ config })
const { moved, alreadyStored } = await moveLocalGalleryFilesToStorage(payload)
payload.logger.info(`Gallery files moved to object storage: ${moved}. Already stored: ${alreadyStored}.`)
process.exit(0)
