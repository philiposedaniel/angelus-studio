'use client'

import { useActionState } from 'react'

import { payDeposit, type DepositState } from '@/app/(frontend)/[locale]/quote/[token]/actions'
import type { Dictionary } from '@/i18n/dictionaries'

type Props = {
  token: string
  locale: string
  t: Dictionary['quote']
}

/** Starts the deposit payment. The server decides the amount; this only sends the quote's token. */
export function DepositButton({ token, locale, t }: Props) {
  const [state, action, pending] = useActionState<DepositState, FormData>(payDeposit, { status: 'idle' })

  return (
    <form action={action} className="grid gap-3">
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="locale" value={locale} />
      <button
        type="submit"
        disabled={pending}
        className="w-fit rounded-full bg-gold px-6 py-3 font-medium text-charcoal disabled:opacity-60"
      >
        {pending ? t.paying : t.payDeposit}
      </button>
      {state.status === 'error' && (
        <p role="alert" className="text-copper">
          {state.message === 'unavailable' ? t.paymentUnavailable : t.paymentFailed}
        </p>
      )}
    </form>
  )
}
