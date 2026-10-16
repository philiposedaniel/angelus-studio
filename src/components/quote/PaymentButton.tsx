'use client'

import { useActionState } from 'react'

import { payBalance, payDeposit, type PaymentState } from '@/app/(frontend)/[locale]/quote/[token]/actions'
import type { Dictionary } from '@/i18n/dictionaries'

type Props = {
  kind: 'deposit' | 'balance'
  token: string
  locale: string
  t: Dictionary['quote']
}

/** Starts a payment. The server decides the amount; this only sends the quote's token. */
export function PaymentButton({ kind, token, locale, t }: Props) {
  const [state, action, pending] = useActionState<PaymentState, FormData>(
    kind === 'deposit' ? payDeposit : payBalance,
    { status: 'idle' },
  )

  return (
    <form action={action} className="grid gap-3">
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="locale" value={locale} />
      <button
        type="submit"
        disabled={pending}
        className="w-fit rounded-full bg-gold px-6 py-3 font-medium text-charcoal disabled:opacity-60"
      >
        {pending ? t.paying : kind === 'deposit' ? t.payDeposit : t.payBalance}
      </button>
      {state.status === 'error' && (
        <p role="alert" className="text-copper">
          {state.message === 'unavailable' ? t.paymentUnavailable : t.paymentFailed}
        </p>
      )}
    </form>
  )
}
