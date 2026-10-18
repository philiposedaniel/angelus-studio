'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

const ACTIONS = {
  invitations: {
    path: '/api/event-guests/send-invitations',
    button: (guests: string) => `Email invitations to ${guests}`,
    confirm: (guests: string) => `Each of ${guests} gets their personal invitation link by email.`,
    done: (count: number) => `Sending ${count} invitations. They go out within a minute.`,
    failed: 'The invitations could not be sent.',
  },
  reminders: {
    path: '/api/event-guests/send-reminders',
    button: (guests: string) => `Remind ${guests} who have not replied`,
    confirm: (guests: string) => `Each of ${guests} gets an email asking them to reply, with their invitation link.`,
    done: (count: number) => `Sending ${count} reminders. They go out within a minute.`,
    failed: 'The reminders could not be sent.',
  },
} as const

/**
 * Emails the event's guests (invitations not sent yet, or reminders to reply) after a second
 * click, then reloads to show the new count.
 */
export function SendInvitationsButton({
  eventId,
  waiting,
  action = 'invitations',
}: {
  eventId: number | string
  waiting: number
  action?: keyof typeof ACTIONS
}) {
  const router = useRouter()
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null)
  const guests = waiting === 1 ? '1 guest' : `${waiting} guests`
  const copy = ACTIONS[action]

  const send = async () => {
    setBusy(true)
    setMessage(null)
    try {
      const response = await fetch(copy.path, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: eventId }),
      })
      const body = await response.json().catch(() => null)
      if (!response.ok) setMessage({ text: body?.errors?.[0]?.message ?? copy.failed, error: true })
      else {
        setMessage({ text: copy.done(body?.queued ?? 0), error: false })
        router.refresh()
      }
    } catch {
      setMessage({ text: `${copy.failed} Please try again.`, error: true })
    } finally {
      setBusy(false)
      setConfirming(false)
    }
  }

  return (
    <div style={{ display: 'grid', gap: 8, justifyItems: 'start' }}>
      {confirming ? (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <span>{copy.confirm(guests)}</span>
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
          {copy.button(guests)}
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
