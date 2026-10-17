'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

/** Refunds the ticket after a second click, then reloads the page to show the new state. */
export function RefundButton({ registrationId, label }: { registrationId: number | string; label: string }) {
  const router = useRouter()
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refund = async () => {
    setBusy(true)
    setError(null)
    try {
      const response = await fetch(`/api/registrations/${encodeURIComponent(String(registrationId))}/refund`, {
        method: 'POST',
        credentials: 'include',
      })
      if (!response.ok) {
        const body = await response.json().catch(() => null)
        setError(body?.errors?.[0]?.message ?? 'The refund could not be made.')
      } else router.refresh()
    } catch {
      setError('The refund could not be sent. Please try again.')
    } finally {
      setBusy(false)
      setConfirming(false)
    }
  }

  return (
    <div style={{ display: 'grid', gap: 8, justifyItems: 'start' }}>
      {confirming ? (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <span>The money goes back to the buyer and the ticket stops working. This cannot be undone.</span>
          <button type="button" className="btn btn--style-primary btn--size-small" disabled={busy} onClick={refund}>
            {busy ? 'Refunding…' : 'Yes, refund'}
          </button>
          <button type="button" className="btn btn--style-secondary btn--size-small" disabled={busy} onClick={() => setConfirming(false)}>
            Keep the ticket
          </button>
        </div>
      ) : (
        <button type="button" className="btn btn--style-secondary btn--size-small" onClick={() => setConfirming(true)}>
          {label}
        </button>
      )}
      {error && (
        <p role="alert" style={{ margin: 0, color: 'var(--theme-error-500)' }}>
          {error}
        </p>
      )}
    </div>
  )
}
