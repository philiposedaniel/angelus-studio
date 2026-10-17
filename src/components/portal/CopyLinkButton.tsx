'use client'

import { useState } from 'react'

/** Copies an invitation link so the organizer can send it to the guest. */
export function CopyLinkButton({ value, label, copied }: { value: string; label: string; copied: string }) {
  const [done, setDone] = useState(false)
  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(value).catch(() => null)
        setDone(true)
        setTimeout(() => setDone(false), 2000)
      }}
      className="rounded-full border border-gold/60 px-4 py-1.5 text-sm text-gold transition-colors hover:bg-gold hover:text-ink"
    >
      <span aria-live="polite">{done ? copied : label}</span>
    </button>
  )
}
