import type { Payload } from 'payload'

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
