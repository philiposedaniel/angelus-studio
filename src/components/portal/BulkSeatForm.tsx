'use client'

import { useRouter } from 'next/navigation'
import { startTransition, useActionState, useEffect, useRef } from 'react'

import { seatGuests } from '@/app/(frontend)/[locale]/portal/events/[id]/actions'
import type { Dictionary } from '@/i18n/dictionaries'
import type { GuestSeatState } from '@/lib/organizerGuests'

/** The form the guest list's checkboxes belong to, through their `form` attribute. */
export const BULK_SEAT_FORM_ID = 'bulk-seat'

const count = (forms: { one: string; other: string }, n: number) => (n === 1 ? forms.one : forms.other).replace('{count}', String(n))

/**
 * Seats every guest ticked in the list at one table, or takes them off their tables. The
 * checkboxes sit in the list items, outside this form, and join it by its id.
 */
export function BulkSeatForm({
  eventId,
  tables,
  t,
}: {
  eventId: number
  tables: { value: string; label: string }[]
  t: Dictionary['organizer']['bulkSeat']
}) {
  const [state, action, pending] = useActionState<GuestSeatState, FormData>(seatGuests, { status: 'idle' })
  const form = useRef<HTMLFormElement>(null)
  const router = useRouter()

  useEffect(() => {
    if (state.status !== 'seated') return
    form.current?.reset()
    router.refresh()
  }, [state, router])

  return (
    <form
      id={BULK_SEAT_FORM_ID}
      ref={form}
      className="flex flex-wrap items-end gap-3"
      onSubmit={(event) => {
        event.preventDefault()
        const data = new FormData(event.currentTarget)
        startTransition(() => action(data))
      }}
    >
      <input type="hidden" name="event" value={eventId} />
      <div className="grid gap-1 text-sm text-mist">
        <label htmlFor="bulk-seat-table">{t.table}</label>
        <select
          id="bulk-seat-table"
          name="table"
          defaultValue={tables[0]?.value ?? ''}
          className="max-w-full rounded-lg border border-ivory/15 bg-ink px-4 py-3 text-ivory focus:border-gold focus:outline-none"
        >
          {tables.map((table) => (
            <option key={table.value} value={table.value}>
              {table.label}
            </option>
          ))}
          <option value="">{t.noTable}</option>
        </select>
      </div>
      <button
        type="submit"
        disabled={pending}
        className="rounded-full border border-gold px-6 py-3 text-sm font-medium text-gold transition-colors hover:bg-gold hover:text-ink disabled:opacity-50"
      >
        {t.button}
      </button>
      <div role="status" aria-live="polite" className="min-h-11 content-center text-sm">
        {!pending && state.status === 'seated' && (
          <p className="text-gold">{count(state.cleared ? t.cleared : t.seated, state.count)}</p>
        )}
        {!pending && state.status === 'error' && <p className="text-copper">{t.errors[state.reason]}</p>}
      </div>
    </form>
  )
}
