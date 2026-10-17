'use client'

import { useActionState } from 'react'

import { confirmBooking } from '@/app/(frontend)/[locale]/vendor/[token]/actions'
import type { Dictionary } from '@/i18n/dictionaries'
import type { ConfirmState } from '@/lib/vendors'

const input =
  'w-full rounded-lg border border-ivory/15 bg-ink px-4 py-3 text-ivory placeholder:text-mist/60 focus:border-gold focus:outline-none'

/** The vendor confirms they will be there, with an optional note for the studio. */
export function ConfirmBookingForm({ token, t }: { token: string; t: Dictionary['vendorBooking'] }) {
  const [state, action, pending] = useActionState<ConfirmState, FormData>(confirmBooking, { status: 'idle' })

  if (state.status === 'confirmed') {
    return (
      <p role="status" className="text-gold">
        {t.confirmed}
      </p>
    )
  }

  return (
    <form action={action} className="grid gap-4">
      <input type="hidden" name="token" value={token} />
      <label htmlFor="vendor-note" className="text-sm text-mist">
        {t.note}
      </label>
      <textarea id="vendor-note" name="vendorNote" maxLength={1000} className={input} />
      <button
        type="submit"
        disabled={pending}
        className="w-fit rounded-full bg-gold px-8 py-3 font-medium text-ink transition-colors hover:bg-ivory disabled:opacity-60"
      >
        {pending ? t.confirming : t.confirm}
      </button>
      {state.status === 'error' && (
        <p role="alert" className="text-copper">
          {t.failed}
        </p>
      )}
    </form>
  )
}
