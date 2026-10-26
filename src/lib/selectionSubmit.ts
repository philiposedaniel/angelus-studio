import type { Payload } from 'payload'

import type { User } from '@/payload-types'
import { selectionIsLocked } from '@/lib/selections'
import { queueSelectionNotice } from '@/lib/selectionNotices'

// Server-only: queues email and reads access rules. Client components must import '@/lib/selections'
// instead, which stays free of server code.

export type SubmitResult =
  | { status: 'submitted' }
  | { status: 'empty' | 'locked' | 'not-found' }

/**
 * Submits the signed-in client's favorites in a gallery as their selection. The gallery must be
 * one they can see; the selection is written by the server, never by a client's own request.
 */
export async function submitSelection({
  payload,
  user,
  galleryId,
}: {
  payload: Payload
  user: User
  galleryId: number
}): Promise<SubmitResult> {
  // The client's own view of the gallery decides whether they may submit for it.
  const gallery = await payload
    .findByID({ collection: 'galleries', id: galleryId, user, overrideAccess: false, depth: 0 })
    .catch(() => null)
  if (!gallery) return { status: 'not-found' }

  const favorites = await payload.count({
    collection: 'gallery-favorites',
    where: { and: [{ user: { equals: user.id } }, { gallery: { equals: galleryId } }] },
    overrideAccess: true,
  })
  if (favorites.totalDocs === 0) return { status: 'empty' }

  const { docs } = await payload.find({
    collection: 'gallery-selections',
    where: { and: [{ user: { equals: user.id } }, { gallery: { equals: galleryId } }] },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })
  const existing = docs[0]
  if (existing && selectionIsLocked(existing.status)) return { status: 'locked' }

  const submittedAt = new Date().toISOString()
  const saved = existing
    ? await payload.update({
        collection: 'gallery-selections',
        id: existing.id,
        data: { status: 'submitted', submittedAt },
        overrideAccess: true,
      })
    : await payload.create({
        collection: 'gallery-selections',
        data: {
          tenant: typeof gallery.tenant === 'object' ? gallery.tenant?.id : gallery.tenant,
          gallery: galleryId,
          user: user.id,
          status: 'submitted',
          submittedAt,
        },
        overrideAccess: true,
      })
  // Queued after the save, so the studio is told only about a submission that was kept.
  await queueSelectionNotice(payload, saved.id)
  return { status: 'submitted' }
}
