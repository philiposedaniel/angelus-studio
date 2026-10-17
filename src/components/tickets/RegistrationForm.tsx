'use client'

import { startTransition, useActionState, useState, type ReactNode } from 'react'

import { joinWaitlistAction, register } from '@/app/(frontend)/[locale]/events/[slug]/actions'
import type { Dictionary } from '@/i18n/dictionaries'
import { cn } from '@/lib/cn'
import type { RegistrationField, RegistrationState } from '@/lib/tickets'
import type { WaitlistJoinState } from '@/lib/waitlist'

type Offer = { id: number; name: string; left: number; maxPerOrder: number; price: number; priceLabel: string }

type Props = {
  eventId: number
  locale: string
  formToken: string
  offers: Offer[]
  t: Dictionary['tickets']
  /** Joins the waitlist of sold-out tickets instead of registering. */
  waitlist?: boolean
  /** Asks for a promo code, when the event has one that could work. */
  promoCodes?: boolean
}

type State = RegistrationState | WaitlistJoinState

// The two server actions take the same form; only what they do with it differs.
const joinAction = joinWaitlistAction as (previous: State, form: FormData) => Promise<State>
const registerAction = register as (previous: State, form: FormData) => Promise<State>

const input =
  'w-full rounded-lg border border-ivory/15 bg-charcoal px-4 py-3 text-ivory placeholder:text-mist/60 focus:border-gold focus:outline-none aria-[invalid=true]:border-copper'

const plural = (forms: { one: string; other: string }, count: number) =>
  (count === 1 ? forms.one : forms.other).replace('{count}', String(count))

/**
 * Registration for an event, or joining a sold-out ticket's waitlist. Every check runs again on
 * the server; success opens the ticket, the payment or the waitlist link.
 */
export function RegistrationForm({ eventId, locale, formToken, offers, t, waitlist = false, promoCodes = false }: Props) {
  const [state, action, pending] = useActionState<State, FormData>(waitlist ? joinAction : registerAction, {
    status: 'idle',
  })
  const prefix = waitlist ? 'waitlist' : 'registration'
  const [ticketType, setTicketType] = useState(String(offers[0]?.id ?? ''))
  const offer = offers.find((o) => String(o.id) === ticketType) ?? offers[0]
  // On the waitlist people can ask for as many places as one order allows.
  const most = Math.max(1, waitlist ? (offer?.maxPerOrder ?? 1) : Math.min(offer?.left ?? 1, offer?.maxPerOrder ?? 1))
  const paid = !waitlist && (offer?.price ?? 0) > 0

  const errors = state.status === 'error' ? (state.errors ?? {}) : {}
  const field = (name: RegistrationField, label: string, control: ReactNode, wide = false) => (
    <div className={cn('flex flex-col gap-2', wide && 'sm:col-span-2')}>
      <label htmlFor={`${prefix}-${name}`} className="text-sm text-mist">
        {label}
      </label>
      {control}
      {errors[name] && (
        <p id={`${prefix}-${name}-error`} className="text-sm text-copper">
          {t.errors[errors[name]]}
        </p>
      )}
    </div>
  )
  const a11y = (name: RegistrationField) => ({
    id: `${prefix}-${name}`,
    name,
    'aria-invalid': errors[name] ? true : undefined,
    'aria-describedby': errors[name] ? `${prefix}-${name}-error` : undefined,
  })
  const problem =
    state.status === 'error' && state.reason
      ? state.reason === 'notEnough'
        ? plural(t.errors.notEnough, 'remaining' in state ? (state.remaining ?? 0) : 0)
        : t.errors[state.reason]
      : null

  return (
    <form
      aria-label={waitlist ? t.waitlist.heading : t.register}
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
        <label htmlFor={`${prefix}-website`}>Website</label>
        <input id={`${prefix}-website`} type="text" name="website" tabIndex={-1} autoComplete="off" />
      </div>

      {field(
        'ticketType',
        t.ticket,
        <select {...a11y('ticketType')} value={ticketType} onChange={(e) => setTicketType(e.target.value)} className={input}>
          {offers.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name} · {o.price > 0 ? t.perPlace.replace('{price}', o.priceLabel) : t.free}
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
      {!waitlist &&
        promoCodes &&
        (offer?.price ?? 0) > 0 &&
        field(
          'promoCode',
          t.promoCode,
          <input {...a11y('promoCode')} type="text" autoComplete="off" maxLength={40} className={cn(input, 'uppercase')} />,
        )}
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
          <p id={`${prefix}-consent-error`} className="text-sm text-copper">
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
          {waitlist
            ? pending
              ? t.waitlist.submitting
              : t.waitlist.submit
            : pending
              ? paid
                ? t.paying
                : t.submitting
              : paid
                ? t.pay
                : t.submit}
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
