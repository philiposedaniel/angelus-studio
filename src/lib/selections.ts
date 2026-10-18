import type { Payload } from 'payload'

import type { User } from '@/payload-types'

/**
 * A client's selection of photos from one gallery. Their favorites in that gallery are the
 * selection. Staff review it in the admin: they ask for changes, which reopens it, or approve
 * it, which locks it as final.
 */
export const SELECTION_STATUSES = ['open', 'submitted', 'revision-requested', 'approved'] as const
export type SelectionStatus = (typeof SELECTION_STATUSES)[number]

/** While the studio reviews a submitted or approved selection, the client cannot change it. */
export const selectionIsLocked = (status: SelectionStatus | null | undefined) =>
  status === 'submitted' || status === 'approved'

/** The client can submit when the selection is open, or when the studio has asked for changes. */
export const selectionCanSubmit = (status: SelectionStatus | null | undefined) =>
  !selectionIsLocked(status)

/** True when the gallery has a limit and the client already has that many selected photos. */
export const quotaReached = (selected: number, limit: number | null | undefined) =>
  typeof limit === 'number' && limit > 0 && selected >= limit

/** Whether the client's selection in this gallery is locked. Missing selection means open. */
export async function selectionLockedFor(
  payload: Payload,
  userId: number,
  galleryId: number,
): Promise<boolean> {
  const { docs } = await payload.find({
    collection: 'gallery-selections',
    where: { and: [{ user: { equals: userId } }, { gallery: { equals: galleryId } }] },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })
  return selectionIsLocked(docs[0]?.status)
}

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
  if (existing) {
    await payload.update({
      collection: 'gallery-selections',
      id: existing.id,
      data: { status: 'submitted', submittedAt },
      overrideAccess: true,
    })
  } else {
    await payload.create({
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
  }
  return { status: 'submitted' }
}
