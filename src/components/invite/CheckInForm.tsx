'use client'

import { useActionState } from 'react'

import { checkIn } from '@/app/(frontend)/[locale]/invite/[token]/check-in/actions'
import type { Dictionary } from '@/i18n/dictionaries'
import type { CheckInState } from '@/lib/checkIn'

type Props = {
  token: string
  partySize: number
  initialCount: number
  checkedIn: boolean
  t: Dictionary['checkIn']
}

const input =
  'w-full rounded-lg border border-ivory/15 bg-ink px-4 py-3 text-ivory focus:border-gold focus:outline-none'

/** Staff record how many of the party arrived. Choosing 0 undoes the check-in. */
export function CheckInForm({ token, partySize, initialCount, checkedIn, t }: Props) {
  const [state, action, pending] = useActionState<CheckInState, FormData>(checkIn, { status: 'idle' })

  return (
    <form action={action} className="grid gap-4">
      <input type="hidden" name="token" value={token} />
      <label htmlFor="check-in-count" className="text-sm text-mist">
        {t.howManyArrived}
      </label>
      <select id="check-in-count" name="count" defaultValue={String(initialCount)} className={input}>
        {Array.from({ length: partySize + 1 }, (_, n) => n).map((n) => (
          <option key={n} value={n}>
            {n === 0 ? t.undo : n}
          </option>
        ))}
      </select>
      <button
        type="submit"
        disabled={pending}
        className="rounded-full bg-gold px-8 py-4 text-lg font-medium text-ink transition-colors hover:bg-ivory disabled:opacity-60"
      >
        {pending ? t.saving : checkedIn ? t.update : t.checkIn}
      </button>
      {state.status === 'saved' && (
        <p role="status" className="text-gold">
          {state.count === 0 ? t.undone : t.done}
        </p>
      )}
      {state.status === 'error' && (
        <p role="alert" className="text-copper">
          {t.errors[state.reason]}
        </p>
      )}
    </form>
  )
}
