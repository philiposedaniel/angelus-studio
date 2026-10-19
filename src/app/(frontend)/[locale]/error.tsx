'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

import { getErrorText, localeFromPath } from '@/i18n/dictionaries/errors'

/** A page that failed on the server, shown inside the site's header and footer in the visitor's language. */
export default function PageError({
  error,
  retry,
}: {
  error: Error & { digest?: string }
  retry: () => void
}) {
  const locale = localeFromPath(usePathname())
  const t = getErrorText(locale)
  return (
    <section className="mx-auto flex max-w-xl flex-col items-center px-6 py-32 text-center">
      <h1 className="font-display text-4xl sm:text-5xl">{t.title}</h1>
      <p className="mt-4 text-mist">{t.text}</p>
      <div className="mt-10 flex flex-wrap justify-center gap-4">
        <button
          type="button"
          onClick={() => retry()}
          className="inline-flex items-center justify-center rounded-full bg-gold px-7 py-3 text-sm font-medium tracking-wide text-ink uppercase transition-colors hover:bg-ivory"
        >
          {t.retry}
        </button>
        <Link
          href={`/${locale}`}
          className="inline-flex items-center justify-center rounded-full border border-ivory/40 px-7 py-3 text-sm font-medium tracking-wide text-ivory uppercase transition-colors hover:border-gold hover:text-gold"
        >
          {t.home}
        </Link>
      </div>
      {error.digest && (
        <p className="mt-8 text-xs text-mist">
          {t.reference}: {error.digest}
        </p>
      )}
    </section>
  )
}
