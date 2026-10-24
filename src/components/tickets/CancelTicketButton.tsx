'use client'

import { startTransition, useActionState } from 'react'

import { cancelTicketAction, type CancelTicketState } from '@/app/(frontend)/[locale]/tickets/[token]/actions'
import type { Dictionary } from '@/i18n/dictionaries'

/** Cancels the holder's free registration after they confirm. The server checks again. */
export function CancelTicketButton({ token, event, t }: { token: string; event: string; t: Dictionary['tickets']['cancel'] }) {
  const [state, action, pending] = useActionState<CancelTicketState, FormData>(cancelTicketAction, { status: 'idle' })
  return (
    <form
      className="grid gap-3"
      onSubmit={(submitted) => {
        submitted.preventDefault()
        if (!window.confirm(t.confirm.replace('{event}', event))) return
        const data = new FormData(submitted.currentTarget)
        startTransition(() => action(data))
      }}
    >
      <input type="hidden" name="token" value={token} />
      <p className="text-sm text-mist">{t.help}</p>
      <button
        type="submit"
        disabled={pending}
        className="w-fit rounded-full border border-ivory/30 px-6 py-3 text-ivory transition-colors hover:border-copper disabled:opacity-60"
      >
        {pending ? t.cancelling : t.button}
      </button>
      {state.status === 'error' && (
        <p role="alert" className="text-copper">
          {t.errors[state.reason]}
        </p>
      )}
    </form>
  )
}
