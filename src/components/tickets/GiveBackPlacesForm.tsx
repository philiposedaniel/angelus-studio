'use client'

import { useRouter } from 'next/navigation'
import { startTransition, useActionState, useEffect } from 'react'

import { giveBackPlacesAction, type GiveBackPlacesState } from '@/app/(frontend)/[locale]/tickets/[token]/actions'
import type { Dictionary } from '@/i18n/dictionaries'

const plural = (forms: { one: string; other: string }, count: number) =>
  (count === 1 ? forms.one : forms.other).replace('{count}', String(count))

/** Keeps fewer of a free registration's places, giving the rest back. The server checks again. */
export function GiveBackPlacesForm({ token, quantity, t }: { token: string; quantity: number; t: Dictionary['tickets']['giveBack'] }) {
  const [state, action, pending] = useActionState<GiveBackPlacesState, FormData>(giveBackPlacesAction, { status: 'idle' })
  const router = useRouter()

  useEffect(() => {
    if (state.status === 'reduced') router.refresh()
  }, [state, router])

  return (
    <form
      className="grid gap-3"
      onSubmit={(submitted) => {
        submitted.preventDefault()
        const data = new FormData(submitted.currentTarget)
        startTransition(() => action(data))
      }}
    >
      <input type="hidden" name="token" value={token} />
      <p className="text-sm text-mist">{t.help}</p>
      <div className="flex flex-wrap items-end gap-3">
        <div className="grid gap-1 text-sm text-mist">
          <label htmlFor="give-back-keep">{t.keep}</label>
          <select
            id="give-back-keep"
            name="keep"
            defaultValue={String(quantity - 1)}
            className="rounded-lg border border-ivory/15 bg-ink px-4 py-3 text-ivory focus:border-gold focus:outline-none"
          >
            {Array.from({ length: quantity - 1 }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                {plural(t.places, n)}
              </option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          disabled={pending}
          className="rounded-full border border-ivory/30 px-6 py-3 text-ivory transition-colors hover:border-gold disabled:opacity-60"
        >
          {pending ? t.saving : t.button}
        </button>
      </div>
      <div role="status" aria-live="polite" className="text-sm">
        {!pending && state.status === 'reduced' && <p className="text-gold">{plural(t.done, state.quantity)}</p>}
        {!pending && state.status === 'error' && <p className="text-copper">{t.errors[state.reason]}</p>}
      </div>
    </form>
  )
}
