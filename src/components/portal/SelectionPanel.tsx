'use client'

import { useState, useTransition } from 'react'

import { submitGallerySelection } from '@/app/(frontend)/[locale]/portal/galleries/[slug]/actions'
import type { Dictionary } from '@/i18n/dictionaries/en'
import { selectionCanSubmit, selectionIsLocked, type SelectionStatus } from '@/lib/selections'

type Props = {
  galleryId: number
  initialStatus: SelectionStatus
  selected: number
  limit: number | null
  feedback: string | null
  t: Dictionary['selection']
}

/** The client's selection in a gallery: how many photos they have chosen, and where it stands with the studio. */
export function SelectionPanel({ galleryId, initialStatus, selected, limit, feedback, t }: Props) {
  const [status, setStatus] = useState(initialStatus)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const canSubmit = selectionCanSubmit(status) && selected > 0

  const statusText: Record<SelectionStatus, string> = {
    open: t.statusOpen,
    submitted: t.statusSubmitted,
    'revision-requested': t.statusRevision,
    approved: t.statusApproved,
  }

  function submit() {
    setError(null)
    startTransition(async () => {
      const result = await submitGallerySelection(galleryId)
      if (result.status === 'submitted') {
        setStatus('submitted')
        return
      }
      const messages: Record<Exclude<typeof result.status, 'submitted'>, string> = {
        empty: t.emptyError,
        locked: t.lockedError,
        'not-found': t.notFoundError,
        forbidden: t.forbiddenError,
      }
      setError(messages[result.status])
    })
  }

  return (
    <section aria-labelledby="selection-heading" className="mt-8 grid gap-4 rounded-2xl border border-ivory/15 p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 id="selection-heading" className="font-serif text-2xl">
          {t.heading}
        </h2>
        <p className="text-mist">
          {t.selected}: <span className="text-ivory">{selected}</span>
          {limit !== null && <span> / {limit}</span>}
        </p>
      </div>

      <p className={selectionIsLocked(status) ? 'text-gold' : 'text-mist'}>{statusText[status]}</p>

      {status === 'revision-requested' && feedback && (
        <div className="grid gap-2 border-l-2 border-gold pl-4">
          <h3 className="text-sm uppercase tracking-wide text-mist">{t.feedbackHeading}</h3>
          <p className="whitespace-pre-line text-ivory">{feedback}</p>
        </div>
      )}

      {canSubmit && (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={submit}
            disabled={pending}
            className="rounded-full bg-gold px-5 py-2 text-sm text-ink transition-opacity disabled:opacity-60"
          >
            {pending ? t.submitting : t.submit}
          </button>
          {selected === 0 && <p className="text-mist">{t.emptyHint}</p>}
        </div>
      )}

      {error && (
        <p role="alert" className="text-copper">
          {error}
        </p>
      )}
    </section>
  )
}
