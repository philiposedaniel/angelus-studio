'use client'

import { usePathname } from 'next/navigation'

import { getErrorText, localeFromPath } from '@/i18n/dictionaries/errors'

// Shown when the site's own layout cannot load, for example while the database is unreachable.
// It replaces the whole document, so it carries its own styles: the site's stylesheet would also
// reach the admin, which shares this file.
const colors = { ink: '#0b0b0c', ivory: '#f5f1e8', mist: '#b9b4aa', gold: '#d4b77a' }

export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string }
  retry: () => void
}) {
  const locale = localeFromPath(usePathname())
  const t = getErrorText(locale)
  return (
    <html lang={locale}>
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: colors.ink,
          color: colors.ivory,
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        <title>{t.title}</title>
        <main style={{ maxWidth: '36rem', padding: '2rem 1.5rem', textAlign: 'center' }}>
          <h1
            style={{ fontFamily: "'Times New Roman', serif", fontWeight: 400, fontSize: '2.5rem' }}
          >
            {t.title}
          </h1>
          <p style={{ color: colors.mist, lineHeight: 1.6 }}>{t.text}</p>
          <button
            type="button"
            onClick={() => retry()}
            style={{
              marginTop: '1.5rem',
              border: 0,
              borderRadius: '999px',
              padding: '0.75rem 1.75rem',
              background: colors.gold,
              color: colors.ink,
              font: 'inherit',
              fontSize: '0.875rem',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              cursor: 'pointer',
            }}
          >
            {t.retry}
          </button>
          {error.digest && (
            <p style={{ marginTop: '2rem', fontSize: '0.75rem', color: colors.mist }}>
              {t.reference}: {error.digest}
            </p>
          )}
        </main>
      </body>
    </html>
  )
}
