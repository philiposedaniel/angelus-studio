'use client'

import { CheckCircle2 } from 'lucide-react'
import { startTransition, useActionState, useState } from 'react'

import { sendRsvp } from '@/app/(frontend)/[locale]/invite/[token]/actions'
import type { Dictionary } from '@/i18n/dictionaries'
import type { RsvpField, RsvpState } from '@/lib/rsvp'
import { RSVP_LIMITS } from '@/lib/rsvp'

type Props = {
  token: string
  partySize: number
  answered: boolean
  initial: {
    response?: 'attending' | 'declined'
    attendingCount: number
    dietaryNotes: string
    guestMessage: string
  }
  t: Dictionary['invite']
}

const input =
  'w-full rounded-lg border border-ivory/15 bg-ink px-4 py-3 text-ivory placeholder:text-mist/60 focus:border-gold focus:outline-none aria-[invalid=true]:border-copper'

/** A guest's reply. The server checks everything again against their invitation. */
export function RsvpForm({ token, partySize, answered, initial, t }: Props) {
  const [state, action, pending] = useActionState<RsvpState, FormData>(sendRsvp, { status: 'idle' })
  const [response, setResponse] = useState(initial.response)
  const errors = state.status === 'error' ? (state.errors ?? {}) : {}
  const error = (name: RsvpField) =>
    errors[name] && (
      <p id={`rsvp-${name}-error`} className="text-sm text-copper">
        {t.errors[errors[name]]}
      </p>
    )

  return (
    <form
      className="grid gap-5"
      noValidate
      // Submitting by hand keeps what the guest typed if the server asks for a correction.
      onSubmit={(event) => {
        event.preventDefault()
        const data = new FormData(event.currentTarget)
        startTransition(() => action(data))
      }}
    >
      <input type="hidden" name="token" value={token} />

      <fieldset className="grid gap-3" aria-describedby={errors.response ? 'rsvp-response-error' : undefined}>
        <legend className="sr-only">{t.yourReply}</legend>
        {(['attending', 'declined'] as const).map((value) => (
          <label key={value} className="flex items-center gap-3">
            <input
              type="radio"
              name="response"
              value={value}
              checked={response === value}
              onChange={() => setResponse(value)}
              className="size-4 accent-gold"
            />
            {t[value]}
          </label>
        ))}
        {error('response')}
      </fieldset>

      {response === 'attending' && (
        <>
          {partySize > 1 && (
            <div className="grid gap-2">
              <label htmlFor="rsvp-attendingCount" className="text-sm text-mist">
                {t.howMany}
              </label>
              <select
                id="rsvp-attendingCount"
                name="attendingCount"
                defaultValue={String(Math.min(initial.attendingCount, partySize))}
                aria-invalid={errors.attendingCount ? true : undefined}
                className={input}
              >
                {Array.from({ length: partySize }, (_, i) => i + 1).map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
              {error('attendingCount')}
            </div>
          )}
          <div className="grid gap-2">
            <label htmlFor="rsvp-dietaryNotes" className="text-sm text-mist">
              {t.dietaryNotes}
            </label>
            <textarea
              id="rsvp-dietaryNotes"
              name="dietaryNotes"
              defaultValue={initial.dietaryNotes}
              maxLength={RSVP_LIMITS.dietaryNotes}
              aria-invalid={errors.dietaryNotes ? true : undefined}
              className={input}
            />
            {error('dietaryNotes')}
          </div>
        </>
      )}

      <div className="grid gap-2">
        <label htmlFor="rsvp-guestMessage" className="text-sm text-mist">
          {t.guestMessage}
        </label>
        <textarea
          id="rsvp-guestMessage"
          name="guestMessage"
          defaultValue={initial.guestMessage}
          maxLength={RSVP_LIMITS.guestMessage}
          aria-invalid={errors.guestMessage ? true : undefined}
          className={input}
        />
        {error('guestMessage')}
      </div>

      {state.status === 'error' && state.reason && (
        <p role="alert" className="text-sm text-copper">
          {t.errors[state.reason]}
        </p>
      )}
      {state.status === 'saved' && (
        <p role="status" className="flex items-start gap-3 text-ivory">
          <CheckCircle2 aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-gold" />
          {state.response === 'attending' ? t.savedAttending : t.savedDeclined}
        </p>
      )}

      <div className="grid gap-2">
        <button
          type="submit"
          disabled={pending}
          className="w-fit rounded-full bg-gold px-8 py-3 font-medium text-ink transition-colors hover:bg-ivory disabled:opacity-60"
        >
          {pending ? t.sending : answered || state.status === 'saved' ? t.update : t.send}
        </button>
        <p className="text-sm text-mist">{t.canChange}</p>
      </div>
    </form>
  )
}
