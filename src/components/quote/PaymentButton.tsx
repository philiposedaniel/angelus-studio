'use client'

import { useActionState } from 'react'

import { payBalance, payDeposit, payInstallment, type PaymentState } from '@/app/(frontend)/[locale]/quote/[token]/actions'
import type { Dictionary } from '@/i18n/dictionaries'

type Props = {
  kind: 'deposit' | 'balance' | 'installment'
  /** Which installment of the schedule this pays, for kind 'installment'. */
  installmentNumber?: number
  token: string
  locale: string
  t: Dictionary['quote']
}

const ACTIONS = { deposit: payDeposit, balance: payBalance, installment: payInstallment } as const

/** Starts a payment. The server decides the amount; this only sends the quote's token. */
export function PaymentButton({ kind, installmentNumber, token, locale, t }: Props) {
  const [state, action, pending] = useActionState<PaymentState, FormData>(ACTIONS[kind], { status: 'idle' })
  const label =
    kind === 'deposit' ? t.payDeposit : kind === 'balance' ? t.payBalance : t.payInstallment

  return (
    <form action={action} className="grid gap-3">
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="locale" value={locale} />
      {kind === 'installment' && <input type="hidden" name="installment" value={installmentNumber} />}
      <button
        type="submit"
        disabled={pending}
        className="w-fit rounded-full bg-gold px-6 py-3 font-medium text-charcoal disabled:opacity-60"
      >
        {pending ? t.paying : label}
      </button>
      {state.status === 'error' && (
        <p role="alert" className="text-copper">
          {state.message === 'unavailable'
            ? t.paymentUnavailable
            : state.message === 'unsigned'
              ? t.signFirst
              : t.paymentFailed}
        </p>
      )}
    </form>
  )
}
