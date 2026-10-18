'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

/** Emails the invitations not sent yet, after a second click, then reloads to show the count. */
export function SendInvitationsButton({ eventId, waiting }: { eventId: number | string; waiting: number }) {
  const router = useRouter()
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null)
  const guests = waiting === 1 ? '1 guest' : `${waiting} guests`

  const send = async () => {
    setBusy(true)
    setMessage(null)
    try {
      const response = await fetch('/api/event-guests/send-invitations', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: eventId }),
      })
      const body = await response.json().catch(() => null)
      if (!response.ok) setMessage({ text: body?.errors?.[0]?.message ?? 'The invitations could not be sent.', error: true })
      else {
        setMessage({ text: `Sending ${body?.queued ?? 0} invitations. They go out within a minute.`, error: false })
        router.refresh()
      }
    } catch {
      setMessage({ text: 'The invitations could not be sent. Please try again.', error: true })
    } finally {
      setBusy(false)
      setConfirming(false)
    }
  }

  return (
    <div style={{ display: 'grid', gap: 8, justifyItems: 'start' }}>
      {confirming ? (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <span>Each of {guests} gets their personal invitation link by email.</span>
          <button type="button" className="btn btn--style-primary btn--size-small" disabled={busy} onClick={send}>
            {busy ? 'Sending…' : 'Yes, send'}
          </button>
          <button type="button" className="btn btn--style-secondary btn--size-small" disabled={busy} onClick={() => setConfirming(false)}>
            Not now
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="btn btn--style-secondary btn--size-small"
          disabled={waiting === 0}
          onClick={() => setConfirming(true)}
        >
          Email invitations to {guests}
        </button>
      )}
      {message && (
        <p role={message.error ? 'alert' : 'status'} style={{ margin: 0, color: message.error ? 'var(--theme-error-500)' : undefined }}>
          {message.text}
        </p>
      )}
    </div>
  )
}
