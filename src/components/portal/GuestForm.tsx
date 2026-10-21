'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { startTransition, useActionState, useEffect, useRef } from 'react'

import { saveGuest } from '@/app/(frontend)/[locale]/portal/events/[id]/actions'
import type { Dictionary } from '@/i18n/dictionaries'
import type { GuestField, GuestFormState } from '@/lib/organizerGuests'
import { MAX_PARTY_SIZE } from '@/lib/rsvpLimits'

type Guest = {
  id: number
  name: string
  email: string
  phone: string
  group: string
  partySize: number
  language: string
  table: string
}

const input =
  'w-full rounded-lg border border-ivory/15 bg-ink px-4 py-3 text-ivory placeholder:text-mist/60 focus:border-gold focus:outline-none aria-[invalid=true]:border-copper'

/** Adds a guest, or changes one, on an event the organizer manages. The server checks it all again. */
export function GuestForm({
  eventId,
  guest,
  languages,
  tables,
  cancelHref,
  t,
}: {
  eventId: number
  guest: Guest | null
  languages: { value: string; label: string }[]
  /** The event's tables; the choice only appears once the studio has added some. */
  tables: { value: string; label: string }[]
  cancelHref: string
  t: Dictionary['organizer']
}) {
  const [state, action, pending] = useActionState<GuestFormState, FormData>(saveGuest, { status: 'idle' })
  const form = useRef<HTMLFormElement>(null)
  const router = useRouter()
  const errors = state.status === 'error' ? (state.errors ?? {}) : {}

  useEffect(() => {
    if (state.status !== 'saved') return
    if (state.action === 'updated') router.replace(cancelHref)
    else form.current?.reset()
  }, [state, router, cancelHref])

  const field = (name: GuestField, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}, help?: string) => (
    <div className="grid gap-2">
      <label htmlFor={`guest-${name}`} className="text-sm text-mist">
        {label}
      </label>
      <input
        id={`guest-${name}`}
        name={name}
        defaultValue={guest ? String(guest[name]) : undefined}
        aria-invalid={errors[name] ? true : undefined}
        aria-describedby={errors[name] ? `guest-${name}-error` : undefined}
        className={input}
        {...props}
      />
      {help && <p className="text-xs text-mist">{help}</p>}
      {errors[name] && (
        <p id={`guest-${name}-error`} className="text-sm text-copper">
          {t.errors[errors[name]]}
        </p>
      )}
    </div>
  )

  return (
    <form
      ref={form}
      className="grid gap-4 sm:grid-cols-2"
      noValidate
      onSubmit={(event) => {
        event.preventDefault()
        const data = new FormData(event.currentTarget)
        startTransition(() => action(data))
      }}
    >
      <input type="hidden" name="intent" value="save" />
      <input type="hidden" name="event" value={eventId} />
      {guest && <input type="hidden" name="guest" value={guest.id} />}
      {field('name', t.name, { required: true, maxLength: 120, autoComplete: 'off' })}
      {field('email', t.email, { type: 'email', maxLength: 254, autoComplete: 'off' })}
      {field('phone', t.phone, { type: 'tel', maxLength: 40, autoComplete: 'off' })}
      {field('group', t.group, { maxLength: 80 }, t.groupHelp)}
      {field('partySize', t.partySize, { type: 'number', min: 1, max: MAX_PARTY_SIZE, defaultValue: guest?.partySize ?? 1 }, t.partySizeHelp)}
      <div className="grid gap-2">
        <label htmlFor="guest-language" className="text-sm text-mist">
          {t.language}
        </label>
        <select
          id="guest-language"
          name="language"
          defaultValue={guest?.language ?? languages[0]?.value}
          aria-invalid={errors.language ? true : undefined}
          className={input}
        >
          {languages.map((language) => (
            <option key={language.value} value={language.value}>
              {language.label}
            </option>
          ))}
        </select>
      </div>
      {tables.length > 0 && (
        <div className="grid gap-2">
          <label htmlFor="guest-table" className="text-sm text-mist">
            {t.table}
          </label>
          <select
            id="guest-table"
            name="table"
            defaultValue={guest?.table ?? ''}
            aria-invalid={errors.table ? true : undefined}
            aria-describedby={errors.table ? 'guest-table-error' : undefined}
            className={input}
          >
            <option value="">{t.noTable}</option>
            {tables.map((table) => (
              <option key={table.value} value={table.value}>
                {table.label}
              </option>
            ))}
          </select>
          {errors.table && (
            <p id="guest-table-error" className="text-sm text-copper">
              {t.errors[errors.table]}
            </p>
          )}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-4 sm:col-span-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-full bg-gold px-6 py-3 font-medium text-ink transition-opacity disabled:opacity-60"
        >
          {pending ? t.saving : guest ? t.saveChanges : t.add}
        </button>
        {guest && (
          <Link href={cancelHref} className="text-sm text-mist hover:text-gold">
            {t.cancel}
          </Link>
        )}
        <p role="status" className="text-sm text-gold">
          {state.status === 'saved' ? t.saved[state.action] : ''}
        </p>
        {state.status === 'error' && state.reason && (
          <p role="alert" className="text-sm text-copper">
            {t.errors[state.reason]}
          </p>
        )}
      </div>
    </form>
  )
}
