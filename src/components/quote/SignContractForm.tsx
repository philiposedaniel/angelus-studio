'use client'

import { useActionState } from 'react'

import { signContract, type SignState } from '@/app/(frontend)/[locale]/quote/[token]/actions'
import type { Dictionary } from '@/i18n/dictionaries'

type Props = {
  token: string
  locale: string
  t: Dictionary['quote']
}

/**
 * The client types their full name and ticks the agreement box. The server records the signature
 * with the time and the browser; this form only sends what the client typed.
 */
export function SignContractForm({ token, locale, t }: Props) {
  const [state, action, pending] = useActionState<SignState, FormData>(signContract, { status: 'idle' })

  return (
    <form action={action} className="grid gap-4 border-t border-ivory/15 pt-6">
      <h2 className="font-serif text-2xl">{t.signHeading}</h2>
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="locale" value={locale} />
      <label className="grid gap-2">
        <span className="text-mist">{t.signName}</span>
        <input
          name="name"
          required
          maxLength={120}
          autoComplete="name"
          className="rounded-md border border-ivory/25 bg-transparent px-3 py-2 text-ivory"
        />
      </label>
      <label className="flex items-start gap-3">
        <input name="agree" type="checkbox" value="on" required className="mt-1" />
        <span>{t.signAgree}</span>
      </label>
      <button
        type="submit"
        disabled={pending}
        className="w-fit rounded-full bg-gold px-6 py-3 font-medium text-charcoal disabled:opacity-60"
      >
        {pending ? t.signing : t.signContract}
      </button>
      {state.status === 'error' && (
        <p role="alert" className="text-copper">
          {state.message === 'invalid' ? t.signInvalid : t.signFailed}
        </p>
      )}
    </form>
  )
}
