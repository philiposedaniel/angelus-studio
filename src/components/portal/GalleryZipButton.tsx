'use client'

import { Archive, Download, LoaderCircle } from 'lucide-react'
import { useEffect, useState } from 'react'

import { cn } from '@/lib/cn'

type Labels = {
  request: string
  preparing: string
  ready: string
  failed: string
  busy: string
}

type Props = {
  galleryId: number
  scope: 'all' | 'favorites'
  labels: Labels
}

type State =
  | { step: 'idle' }
  | { step: 'preparing'; id: number }
  | { step: 'ready'; id: number }
  | { step: 'error'; message: string }

const POLL_MS = 3000

/** Asks the server to build a ZIP of the gallery, waits for the background job, then offers the file. */
export function GalleryZipButton({ galleryId, scope, labels }: Props) {
  const [state, setState] = useState<State>({ step: 'idle' })

  useEffect(() => {
    // id 0 means the request is still being sent.
    if (state.step !== 'preparing' || !state.id) return
    let cancelled = false
    const check = async () => {
      const response = await fetch(`/api/gallery-downloads/${state.id}?depth=0`, { credentials: 'include' })
      if (cancelled) return
      const doc = response.ok ? ((await response.json()) as { status: string }) : null
      if (doc?.status === 'ready') setState({ step: 'ready', id: state.id })
      else if (!doc || doc.status === 'failed' || doc.status === 'expired') {
        setState({ step: 'error', message: labels.failed })
      } else timer = setTimeout(check, POLL_MS)
    }
    let timer = setTimeout(check, POLL_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [state, labels.failed])

  async function request() {
    setState({ step: 'preparing', id: 0 })
    const response = await fetch('/api/gallery-downloads', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gallery: galleryId, scope }),
    })
    if (response.ok) {
      setState({ step: 'preparing', id: ((await response.json()) as { doc: { id: number } }).doc.id })
    } else {
      setState({ step: 'error', message: response.status === 429 ? labels.busy : labels.failed })
    }
  }

  const button =
    'inline-flex items-center gap-2 rounded-full border border-ivory/20 px-4 py-2 text-sm text-mist transition-colors hover:text-gold disabled:opacity-60'

  if (state.step === 'ready') {
    return (
      <a href={`/api/gallery-downloads/${state.id}/file`} className={cn(button, 'border-gold text-gold')}>
        <Download aria-hidden="true" className="size-4" />
        {labels.ready}
      </a>
    )
  }

  return (
    <span className="inline-flex flex-col gap-1">
      <button type="button" onClick={request} disabled={state.step === 'preparing'} className={button}>
        {state.step === 'preparing' ? (
          <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
        ) : (
          <Archive aria-hidden="true" className="size-4" />
        )}
        {state.step === 'preparing' ? labels.preparing : labels.request}
      </button>
      {state.step === 'error' && (
        <span role="alert" className="text-xs text-copper">
          {state.message}
        </span>
      )}
    </span>
  )
}
