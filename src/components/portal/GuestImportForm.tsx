'use client'

import { useRouter } from 'next/navigation'
import { startTransition, useActionState, useEffect, useRef, useState } from 'react'

import { importGuests } from '@/app/(frontend)/[locale]/portal/events/[id]/actions'
import type { Dictionary } from '@/i18n/dictionaries'
import type { GuestImportState } from '@/lib/organizerGuests'

/** Server actions accept 1 MB, the same as the import's own limit (MAX_IMPORT_CHARS in src/lib/guestCsv.ts). */
const MAX_FILE_BYTES = 1_000_000

const count = (forms: { one: string; other: string }, n: number) => (n === 1 ? forms.one : forms.other).replace('{count}', String(n))

/**
 * Adds guests from a spreadsheet saved as CSV: the file is checked first, showing what would be
 * added and the rows with problems, then added on a second click. The server checks it all again.
 */
export function GuestImportForm({ eventId, t }: { eventId: number; t: Dictionary['organizer']['import'] }) {
  const [state, action, pending] = useActionState<GuestImportState, FormData>(importGuests, { status: 'idle' })
  const form = useRef<HTMLFormElement>(null)
  const router = useRouter()
  const [tooLarge, setTooLarge] = useState(false)

  useEffect(() => {
    if (state.status !== 'added') return
    form.current?.reset()
    router.refresh()
  }, [state, router])

  const submit = (intent: 'check' | 'add') => {
    if (!form.current) return
    const data = new FormData(form.current)
    const file = data.get('file')
    // Larger files are refused here: the server would not accept them.
    setTooLarge(file instanceof File && file.size > MAX_FILE_BYTES)
    if (file instanceof File && file.size > MAX_FILE_BYTES) return
    data.set('intent', intent)
    startTransition(() => action(data))
  }

  return (
    <form
      ref={form}
      className="grid gap-3"
      noValidate
      onSubmit={(event) => {
        event.preventDefault()
        submit('check')
      }}
    >
      <input type="hidden" name="event" value={eventId} />
      <p className="text-sm text-mist">{t.help}</p>
      <label className="grid min-w-0 gap-1 text-sm text-mist">
        {t.file}
        <input
          type="file"
          name="file"
          accept=".csv,text/csv"
          required
          onChange={() => form.current?.requestSubmit()}
          className="w-full min-w-0 max-w-full text-sm text-ivory file:mr-3 file:rounded-full file:border file:border-gold file:bg-transparent file:px-4 file:py-2 file:text-gold"
        />
      </label>
      <div role="status" aria-live="polite" className="grid gap-2 text-sm">
        {pending && <p className="text-mist">{t.checking}</p>}
        {tooLarge && (
          <p role="alert" className="text-copper">
            {t.errors.tooLarge}
          </p>
        )}
        {!pending && !tooLarge && state.status === 'added' && (
          <p className="text-gold">
            {count(t.added, state.added)}
            {state.problems.length > 0 && ` ${count(t.problemRows, state.problems.length)}`}
          </p>
        )}
        {!pending && !tooLarge && state.status === 'checked' && (
          <>
            <p>
              {count(t.ready, state.ready)}
              {state.duplicates > 0 && ` ${count(t.duplicates, state.duplicates)}`}
              {state.problems.length > 0 && ` ${count(t.problemRows, state.problems.length)}`}
            </p>
            {state.preview.length > 0 && (
              <p className="text-mist">
                {t.firstRows} {state.preview.map((guest) => `${guest.name} (${guest.partySize})`).join(', ')}
              </p>
            )}
          </>
        )}
        {!pending && !tooLarge && state.status === 'error' && (
          <p role="alert" className="text-copper">
            {t.errors[state.reason]}
          </p>
        )}
        {!pending && !tooLarge && (state.status === 'checked' || state.status === 'added') && state.problems.length > 0 && (
          <ul className="list-disc pl-5 text-mist">
            {state.problems.slice(0, 20).map((problem) => (
              <li key={`${problem.line}-${problem.code}`}>
                {t.line.replace('{line}', String(problem.line))} {t.problems[problem.code]}
              </li>
            ))}
            {state.problems.length > 20 && <li>{t.more.replace('{count}', String(state.problems.length - 20))}</li>}
          </ul>
        )}
      </div>
      {!tooLarge && state.status === 'checked' && state.ready > 0 && (
        <button
          type="button"
          disabled={pending}
          onClick={() => submit('add')}
          className="w-fit rounded-full bg-gold px-6 py-3 font-medium text-ink transition-opacity disabled:opacity-60"
        >
          {count(t.add, state.ready)}
        </button>
      )}
    </form>
  )
}
