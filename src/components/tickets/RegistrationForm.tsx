'use client'

import { startTransition, useActionState, useState, type ReactNode } from 'react'

import { register } from '@/app/(frontend)/[locale]/events/[slug]/actions'
import type { Dictionary } from '@/i18n/dictionaries'
import { cn } from '@/lib/cn'
import type { RegistrationField, RegistrationState } from '@/lib/tickets'

type Offer = { id: number; name: string; left: number; maxPerOrder: number }

type Props = {
  eventId: number
  locale: string
  formToken: string
  offers: Offer[]
  t: Dictionary['tickets']
}

const input =
  'w-full rounded-lg border border-ivory/15 bg-charcoal px-4 py-3 text-ivory placeholder:text-mist/60 focus:border-gold focus:outline-none aria-[invalid=true]:border-copper'

const plural = (forms: { one: string; other: string }, count: number) =>
  (count === 1 ? forms.one : forms.other).replace('{count}', String(count))

/** Free registration for an event. Every check runs again on the server; success opens the ticket. */
export function RegistrationForm({ eventId, locale, formToken, offers, t }: Props) {
  const [state, action, pending] = useActionState<RegistrationState, FormData>(register, { status: 'idle' })
  const [ticketType, setTicketType] = useState(String(offers[0]?.id ?? ''))
  const offer = offers.find((o) => String(o.id) === ticketType) ?? offers[0]
  const most = Math.max(1, Math.min(offer?.left ?? 1, offer?.maxPerOrder ?? 1))

  const errors = state.status === 'error' ? (state.errors ?? {}) : {}
  const field = (name: RegistrationField, label: string, control: ReactNode, wide = false) => (
    <div className={cn('flex flex-col gap-2', wide && 'sm:col-span-2')}>
      <label htmlFor={`registration-${name}`} className="text-sm text-mist">
        {label}
      </label>
      {control}
      {errors[name] && (
        <p id={`registration-${name}-error`} className="text-sm text-copper">
          {t.errors[errors[name]]}
        </p>
      )}
    </div>
  )
  const a11y = (name: RegistrationField) => ({
    id: `registration-${name}`,
    name,
    'aria-invalid': errors[name] ? true : undefined,
    'aria-describedby': errors[name] ? `registration-${name}-error` : undefined,
  })
  const problem =
    state.status === 'error' && state.reason
      ? state.reason === 'notEnough'
        ? plural(t.errors.notEnough, state.remaining ?? 0)
        : t.errors[state.reason]
      : null

  return (
    <form
      className="grid gap-5 sm:grid-cols-2"
      noValidate
      // Submitting by hand keeps what the visitor typed when the server asks for a correction.
      onSubmit={(event) => {
        event.preventDefault()
        const data = new FormData(event.currentTarget)
        startTransition(() => action(data))
      }}
    >
      <input type="hidden" name="formToken" value={formToken} />
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="event" value={eventId} />
      {/* Hidden from people; bots fill it in. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label htmlFor="registration-website">Website</label>
        <input id="registration-website" type="text" name="website" tabIndex={-1} autoComplete="off" />
      </div>

      {field(
        'ticketType',
        t.ticket,
        <select {...a11y('ticketType')} value={ticketType} onChange={(e) => setTicketType(e.target.value)} className={input}>
          {offers.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name} · {t.free}
            </option>
          ))}
        </select>,
      )}
      {field(
        'quantity',
        t.places,
        <select {...a11y('quantity')} key={ticketType} defaultValue="1" className={input}>
          {Array.from({ length: most }, (_, n) => n + 1).map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>,
      )}
      {field('name', t.name, <input {...a11y('name')} type="text" autoComplete="name" maxLength={120} className={input} />)}
      {field('email', t.email, <input {...a11y('email')} type="email" autoComplete="email" maxLength={200} className={input} />)}
      {field('phone', t.phone, <input {...a11y('phone')} type="tel" autoComplete="tel" maxLength={40} className={input} />)}
      <div className="flex flex-col gap-2 sm:col-span-2">
        <label className="flex items-start gap-3 text-sm text-ivory/90">
          <input
            {...a11y('consent')}
            type="checkbox"
            className="mt-1 size-4 accent-gold"
          />
          {t.consent}
        </label>
        {errors.consent && (
          <p id="registration-consent-error" className="text-sm text-copper">
            {t.errors[errors.consent]}
          </p>
        )}
      </div>
      <div className="grid gap-3 sm:col-span-2">
        <button
          type="submit"
          disabled={pending}
          className="justify-self-start rounded-full bg-gold px-8 py-3 font-medium text-ink transition-colors hover:bg-ivory disabled:opacity-60"
        >
          {pending ? t.submitting : t.submit}
        </button>
        {problem && (
          <p role="alert" className="text-copper">
            {problem}
          </p>
        )}
      </div>
    </form>
  )
}
