import type { Payload } from 'payload'

import { hasTenantRole, isSuperAdmin } from '@/access/roles'
import { EVENT_GUEST_STAFF_ROLES } from '@/collections/EventGuests'
import { findInvitation } from '@/lib/rsvp'
import type { User } from '@/payload-types'

export type CheckInState =
  | { status: 'idle' }
  | { status: 'saved'; count: number }
  | { status: 'error'; reason: 'forbidden' | 'invalid' | 'failed' }

/** Staff who may check guests in: the same people who manage the studio's guest lists. */
export const canCheckIn = (user: User | null | undefined, tenantId: number) =>
  Boolean(user) && (isSuperAdmin(user) || hasTenantRole(user, tenantId, EVENT_GUEST_STAFF_ROLES))

/**
 * Records how many of a guest's party have arrived, from the code on their invitation.
 * Zero undoes the check-in. The save runs as the staff member, so the guest list's own access
 * rules apply as well as the role check here.
 */
export async function checkInGuest({
  payload,
  user,
  tenantId,
  form,
}: {
  payload: Payload
  user: User | null
  tenantId: number
  form: FormData
}): Promise<CheckInState> {
  if (!user || !canCheckIn(user, tenantId)) return { status: 'error', reason: 'forbidden' }
  const found = await findInvitation(payload, tenantId, form.get('token'))
  if (!found) return { status: 'error', reason: 'invalid' }

  const raw = form.get('count')
  const count = typeof raw === 'string' && /^\d+$/.test(raw) ? Number(raw) : NaN
  const partySize = found.guest.partySize ?? 1
  if (!Number.isInteger(count) || count < 0 || count > partySize) return { status: 'error', reason: 'invalid' }

  try {
    await payload.update({
      collection: 'event-guests',
      id: found.guest.id,
      data: { checkedInCount: count },
      user,
      overrideAccess: false,
    })
  } catch (error) {
    payload.logger.error({ err: error, msg: 'Could not check a guest in' })
    return { status: 'error', reason: 'failed' }
  }
  return { status: 'saved', count }
}
