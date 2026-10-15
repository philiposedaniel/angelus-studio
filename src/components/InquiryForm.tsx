'use client'

import { CheckCircle2 } from 'lucide-react'
import { startTransition, useActionState, type ReactNode } from 'react'

import { sendInquiry } from '@/app/(frontend)/[locale]/inquiryAction'
import { EVENT_TYPES } from '@/lib/inquiryOptions'
import type { Dictionary } from '@/i18n/dictionaries'
import type { InquiryField, InquiryState } from '@/lib/inquiries'
import { cn } from '@/lib/cn'

type Props = {
  locale: string
  formToken: string
  t: Dictionary['inquiry']
}

const input =
  'w-full rounded-lg border border-ivory/15 bg-charcoal px-4 py-3 text-ivory placeholder:text-mist/60 focus:border-gold focus:outline-none aria-[invalid=true]:border-copper'

/** The website contact form. All checks run again on the server; this only shows the results. */
export function InquiryForm({ locale, formToken, t }: Props) {
  const [state, action, pending] = useActionState<InquiryState, FormData>(sendInquiry, {
    status: 'idle',
  })

  if (state.status === 'success') {
    return (
      <p
        role="status"
        className="flex items-start gap-3 rounded-xl border border-gold/40 bg-charcoal p-6 text-ivory"
      >
        <CheckCircle2 aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-gold" />
        {t.success}
      </p>
    )
  }

  const errors = state.status === 'error' ? (state.errors ?? {}) : {}
  const field = (name: InquiryField, label: string, control: ReactNode, wide = false) => (
    <div className={cn('flex flex-col gap-2', wide && 'sm:col-span-2')}>
      <label htmlFor={`inquiry-${name}`} className="text-sm text-mist">
        {label}
      </label>
      {control}
      {errors[name] && (
        <p id={`inquiry-${name}-error`} className="text-sm text-copper">
          {t.errors[errors[name]]}
        </p>
      )}
    </div>
  )
  const a11y = (name: InquiryField) => ({
    id: `inquiry-${name}`,
    name,
    'aria-invalid': errors[name] ? true : undefined,
    'aria-describedby': errors[name] ? `inquiry-${name}-error` : undefined,
  })

  return (
    <form
      className="grid gap-5 sm:grid-cols-2"
      noValidate
      // Submitting by hand rather than with `action=` keeps what the visitor typed when the
      // server asks for a correction (React resets forms after an action completes).
      onSubmit={(event) => {
        event.preventDefault()
        const data = new FormData(event.currentTarget)
        startTransition(() => action(data))
      }}
    >
      <input type="hidden" name="formToken" value={formToken} />
      <input type="hidden" name="locale" value={locale} />
      {/* Hidden from people; bots fill it in. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label htmlFor="inquiry-website">Website</label>
        <input id="inquiry-website" type="text" name="website" tabIndex={-1} autoComplete="off" />
      </div>

      {field(
        'name',
        t.name,
        <input {...a11y('name')} className={input} autoComplete="name" required maxLength={120} />,
      )}
      {field(
        'email',
        t.email,
        <input {...a11y('email')} type="email" className={input} autoComplete="email" required />,
      )}
      {field(
        'phone',
        t.phone,
        <input {...a11y('phone')} type="tel" className={input} autoComplete="tel" maxLength={40} />,
      )}
      {field(
        'eventType',
        t.eventType,
        <select {...a11y('eventType')} className={input} required defaultValue="">
          <option value="" disabled>
            {t.choose}
          </option>
          {EVENT_TYPES.map((type) => (
            <option key={type} value={type}>
              {t.eventTypes[type]}
            </option>
          ))}
        </select>,
      )}
      {field(
        'eventDate',
        t.eventDate,
        <input {...a11y('eventDate')} type="date" className={input} />,
      )}
      {field(
        'location',
        t.location,
        <input {...a11y('location')} className={input} maxLength={200} />,
      )}
      {field(
        'message',
        t.message,
        <textarea
          {...a11y('message')}
          className={cn(input, 'min-h-36')}
          required
          maxLength={5000}
        />,
        true,
      )}

      <div className="sm:col-span-2">
        <label className="flex items-start gap-3 text-sm text-mist">
          <input
            type="checkbox"
            name="consent"
            required
            aria-invalid={errors.consent ? true : undefined}
            className="mt-1 size-4 accent-gold"
          />
          {t.consent}
        </label>
        {errors.consent && <p className="mt-2 text-sm text-copper">{t.errors.required}</p>}
      </div>

      {state.status === 'error' && state.reason && (
        <p role="alert" className="text-sm text-copper sm:col-span-2">
          {t.errors[state.reason]}
        </p>
      )}

      <div className="sm:col-span-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-full bg-gold px-8 py-3 font-medium text-ink transition-colors hover:bg-ivory disabled:opacity-60"
        >
          {pending ? t.sending : t.send}
        </button>
      </div>
    </form>
  )
}
