'use client'

import { useActionState } from 'react'

import {
  claimWaitlistAction,
  leaveWaitlistAction,
  type WaitlistActionState,
} from '@/app/(frontend)/[locale]/waitlist/[token]/actions'
import type { Dictionary } from '@/i18n/dictionaries'

type Props = {
  token: string
  locale: string
  /** Whether places are being held for this person now. */
  offered: boolean
  paid: boolean
  t: Dictionary['tickets']['waitlist']
}

/** Taking the places held for someone on the waitlist, or leaving it. The server checks again. */
export function WaitlistActions({ token, locale, offered, paid, t }: Props) {
  const [claimState, claim, claiming] = useActionState<WaitlistActionState, FormData>(claimWaitlistAction, {
    status: 'idle',
  })
  const [leaveState, leave, leaving] = useActionState<WaitlistActionState, FormData>(leaveWaitlistAction, {
    status: 'idle',
  })
  const problem = [claimState, leaveState].find((s) => s.status === 'error')
  const hidden = (
    <>
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="locale" value={locale} />
    </>
  )

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-4">
        {offered && (
          <form action={claim}>
            {hidden}
            <button
              type="submit"
              disabled={claiming || leaving}
              className="rounded-full bg-gold px-8 py-3 font-medium text-ink transition-colors hover:bg-ivory disabled:opacity-60"
            >
              {claiming ? t.claiming : paid ? t.claimPaid : t.claimFree}
            </button>
          </form>
        )}
        <form action={leave}>
          {hidden}
          <button
            type="submit"
            disabled={claiming || leaving}
            className="rounded-full border border-ivory/30 px-6 py-3 text-ivory transition-colors hover:border-gold disabled:opacity-60"
          >
            {leaving ? t.leaving : t.leave}
          </button>
        </form>
      </div>
      {problem?.status === 'error' && (
        <p role="alert" className="text-copper">
          {t.errors[problem.reason]}
        </p>
      )}
    </div>
  )
}
