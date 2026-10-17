import type { Payload } from 'payload'

import type { Locale } from '@/i18n/config'
import { MAX_PARTY_SIZE } from '@/lib/rsvp'
import type { User } from '@/payload-types'

export type GuestField = 'name' | 'email' | 'phone' | 'group' | 'partySize' | 'language'
export type GuestFieldError = 'required' | 'invalid' | 'tooLong'

export type GuestFormState =
  | { status: 'idle' }
  | { status: 'saved'; action: 'added' | 'updated' | 'removed' }
  | { status: 'error'; errors?: Partial<Record<GuestField, GuestFieldError>>; reason?: 'forbidden' | 'failed' }

const LIMITS = { name: 120, email: 254, phone: 40, group: 80 } as const

const text = (form: FormData, key: string) => {
  const value = form.get(key)
  return typeof value === 'string' ? value.trim() : ''
}

/** Checks the guest form an organizer sends from the portal. */
export function validateGuestForm(form: FormData, offeredLanguages: readonly Locale[]) {
  const errors: Partial<Record<GuestField, GuestFieldError>> = {}
  const name = text(form, 'name')
  const email = text(form, 'email').toLowerCase()
  const phone = text(form, 'phone')
  const group = text(form, 'group')
  const language = text(form, 'language') || offeredLanguages[0]
  const rawSize = text(form, 'partySize') || '1'
  const partySize = /^\d+$/.test(rawSize) ? Number(rawSize) : NaN

  if (!name) errors.name = 'required'
  else if (name.length > LIMITS.name) errors.name = 'tooLong'
  if (email.length > LIMITS.email) errors.email = 'tooLong'
  else if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = 'invalid'
  if (phone.length > LIMITS.phone) errors.phone = 'tooLong'
  if (group.length > LIMITS.group) errors.group = 'tooLong'
  if (!Number.isInteger(partySize) || partySize < 1 || partySize > MAX_PARTY_SIZE) errors.partySize = 'invalid'
  if (!offeredLanguages.includes(language as Locale)) errors.language = 'invalid'

  if (Object.keys(errors).length > 0) return { ok: false as const, errors }
  return {
    ok: true as const,
    data: {
      name,
      email: email || null,
      phone: phone || null,
      group: group || null,
      partySize,
      language: language as Locale,
    },
  }
}

const idFrom = (form: FormData, key: string) => {
  const value = text(form, key)
  return /^\d+$/.test(value) ? Number(value) : null
}

/**
 * Adds, changes or removes a guest on an event the user may manage. Everything runs as the user,
 * so the guest list's access rules decide: organizers reach only their own events' guests.
 */
export async function saveGuestFromPortal({
  payload,
  user,
  form,
  offeredLanguages,
}: {
  payload: Payload
  user: User
  form: FormData
  offeredLanguages: readonly Locale[]
}): Promise<GuestFormState> {
  const intent = text(form, 'intent')
  const eventId = idFrom(form, 'event')
  const guestId = idFrom(form, 'guest')
  if (eventId === null) return { status: 'error', reason: 'failed' }

  try {
    if (intent === 'remove') {
      if (guestId === null) return { status: 'error', reason: 'failed' }
      const result = await payload.delete({
        collection: 'event-guests',
        where: { and: [{ id: { equals: guestId } }, { event: { equals: eventId } }] },
        user,
        overrideAccess: false,
      })
      if (result.docs.length !== 1) return { status: 'error', reason: 'forbidden' }
      return { status: 'saved', action: 'removed' }
    }

    const checked = validateGuestForm(form, offeredLanguages)
    if (!checked.ok) return { status: 'error', errors: checked.errors }

    if (guestId !== null) {
      const result = await payload.update({
        collection: 'event-guests',
        where: { and: [{ id: { equals: guestId } }, { event: { equals: eventId } }] },
        data: checked.data,
        user,
        overrideAccess: false,
      })
      if (result.docs.length !== 1) return { status: 'error', reason: 'forbidden' }
      return { status: 'saved', action: 'updated' }
    }

    await payload.create({
      collection: 'event-guests',
      data: { ...checked.data, event: eventId, rsvpStatus: 'pending' },
      user,
      overrideAccess: false,
    })
    return { status: 'saved', action: 'added' }
  } catch (error) {
    const status = (error as { status?: number }).status
    if (status === 403) return { status: 'error', reason: 'forbidden' }
    if (status === 400 && /party|seats/i.test(String((error as Error).message))) {
      return { status: 'error', errors: { partySize: 'invalid' } }
    }
    payload.logger.error({ err: error, msg: 'Could not save a guest from the portal' })
    return { status: 'error', reason: 'failed' }
  }
}
