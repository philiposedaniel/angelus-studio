'use client'

import { useState } from 'react'

/** Copies a value to the clipboard, for the share link and embed code in the admin panel. */
export function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      className="btn btn--style-secondary btn--size-small"
      style={{ margin: 0 }}
      onClick={async () => {
        await navigator.clipboard.writeText(value)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      }}
    >
      {copied ? 'Copied' : label}
    </button>
  )
}
