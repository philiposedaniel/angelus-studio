'use client'

import { useRouter } from 'next/navigation'
import { useState, type FormEvent } from 'react'

type Labels = {
  email: string
  password: string
  signIn: string
  signingIn: string
  loginFailed: string
  authenticatorCode: string
}

export function LoginForm({ redirectTo, labels }: { redirectTo: string; labels: Labels }) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending(true)
    setError(null)
    const form = new FormData(event.currentTarget)
    const response = await fetch('/api/users/login', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: form.get('email'),
        password: form.get('password'),
        // Only staff with authenticator sign-in on need a code; it is sent only when typed.
        ...(String(form.get('totp') ?? '').trim() && { totp: String(form.get('totp')).trim() }),
      }),
    }).catch(() => null)
    if (response?.ok) {
      router.replace(redirectTo)
      router.refresh()
      return
    }
    setPending(false)
    setError(labels.loginFailed)
  }

  const inputClass =
    'mt-2 w-full rounded-xl border border-ivory/20 bg-charcoal px-4 py-3 text-ivory placeholder:text-mist/60 focus:border-gold focus:outline-none'

  return (
    <form onSubmit={onSubmit} className="mt-8 space-y-5" noValidate={false}>
      <label className="block text-sm text-mist">
        {labels.email}
        <input name="email" type="email" autoComplete="email" required className={inputClass} />
      </label>
      <label className="block text-sm text-mist">
        {labels.password}
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className={inputClass}
        />
      </label>
      <label className="block text-sm text-mist">
        {labels.authenticatorCode}
        <input
          name="totp"
          inputMode="numeric"
          autoComplete="one-time-code"
          className={inputClass}
        />
      </label>
      {error && (
        <p role="alert" className="text-sm text-copper">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-full bg-gold px-7 py-3 text-sm font-medium tracking-wide text-ink uppercase transition-colors hover:bg-ivory disabled:opacity-60"
      >
        {pending ? labels.signingIn : labels.signIn}
      </button>
    </form>
  )
}
