'use client'

import { useDocumentInfo } from '@payloadcms/ui'
import { useState } from 'react'

type Result = {
  ready: number
  duplicates: number
  added: number
  problems: { line: number; message: string }[]
  preview: { name: string; email?: string; partySize: number; group?: string }[]
}

const box: React.CSSProperties = { display: 'grid', gap: 8, marginBottom: 24 }
const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

const small: React.CSSProperties = { margin: 0, fontSize: 12, opacity: 0.75 }

/** Adds guests to the event from a CSV file: a preview first, then the import. */
export function GuestImportField() {
  const { id } = useDocumentInfo()
  const [csv, setCsv] = useState<string | null>(null)
  const [result, setResult] = useState<Result | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (!id) return null

  const send = async (text: string, dryRun: boolean) => {
    setBusy(true)
    setError(null)
    try {
      const response = await fetch('/api/event-guests/import', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: id, csv: text, dryRun }),
      })
      const body = await response.json()
      if (!response.ok) {
        setResult(null)
        setError(body?.errors?.[0]?.message ?? 'The file could not be read.')
      } else setResult(body as Result)
    } catch {
      setError('The file could not be sent. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={box}>
      <strong>Import guests from a spreadsheet</strong>
      <p style={small}>
        A CSV file with a header line. Columns: Name (required), Email, Phone, Group, Party size, Language
        (en, es…). Guests whose email is already on the list are skipped.
      </p>
      <input
        type="file"
        accept=".csv,text/csv"
        aria-label="Guest list CSV file"
        disabled={busy}
        onChange={async (event) => {
          const file = event.target.files?.[0]
          setResult(null)
          if (!file) return setCsv(null)
          const text = await file.text()
          setCsv(text)
          await send(text, true)
        }}
      />
      {error && (
        <p role="alert" style={{ margin: 0, color: 'var(--theme-error-500)' }}>
          {error}
        </p>
      )}
      {result && (
        <div style={{ display: 'grid', gap: 6 }} role="status">
          {result.added > 0 ? (
            <p style={{ margin: 0 }}>
              Added {count(result.added, 'guest', 'guests')}. Reload the page to see the new totals.
            </p>
          ) : (
            <p style={{ margin: 0 }}>
              {count(result.ready, 'guest', 'guests')} ready to add
              {result.duplicates > 0 && `, ${result.duplicates} already on the list`}
              {result.problems.length > 0 && `, ${count(result.problems.length, 'row', 'rows')} with problems`}.
            </p>
          )}
          {result.added === 0 && result.preview.length > 0 && (
            <p style={small}>
              First rows: {result.preview.map((g) => `${g.name} (${g.partySize})`).join(', ')}
            </p>
          )}
          {result.problems.length > 0 && (
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12 }}>
              {result.problems.slice(0, 20).map((p) => (
                <li key={`${p.line}-${p.message}`}>
                  Line {p.line}: {p.message}
                </li>
              ))}
              {result.problems.length > 20 && <li>and {result.problems.length - 20} more.</li>}
            </ul>
          )}
          {result.added === 0 && result.ready > 0 && csv && (
            <div>
              <button
                type="button"
                className="btn btn--style-primary btn--size-small"
                style={{ margin: 0 }}
                disabled={busy}
                onClick={() => send(csv, false)}
              >
                {busy ? 'Adding…' : `Add ${count(result.ready, 'guest', 'guests')}`}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
