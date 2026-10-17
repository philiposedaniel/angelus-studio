'use client'

import { startTransition, useActionState } from 'react'

import { saveGuest } from '@/app/(frontend)/[locale]/portal/events/[id]/actions'
import type { Dictionary } from '@/i18n/dictionaries'
import type { GuestFormState } from '@/lib/organizerGuests'

/** Removes a guest after the organizer confirms. */
export function RemoveGuestButton({
  eventId,
  guestId,
  name,
  t,
}: {
  eventId: number
  guestId: number
  name: string
  t: Dictionary['organizer']
}) {
  const [state, action, pending] = useActionState<GuestFormState, FormData>(saveGuest, { status: 'idle' })
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        if (!window.confirm(t.confirmRemove.replace('{name}', name))) return
        const data = new FormData(event.currentTarget)
        startTransition(() => action(data))
      }}
    >
      <input type="hidden" name="intent" value="remove" />
      <input type="hidden" name="event" value={eventId} />
      <input type="hidden" name="guest" value={guestId} />
      <button
        type="submit"
        disabled={pending}
        className="text-sm text-copper underline-offset-4 hover:underline disabled:opacity-50"
      >
        {t.remove}
      </button>
      {state.status === 'error' && (
        <p role="alert" className="text-sm text-copper">
          {t.errors[state.reason ?? 'failed']}
        </p>
      )}
    </form>
  )
}
