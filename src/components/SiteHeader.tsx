import Link from 'next/link'

import { LOCALE_LABELS, type Locale } from '@/i18n/config'
import type { Dictionary } from '@/i18n/dictionaries'
import { cn } from '@/lib/cn'

import { ButtonLink } from './ButtonLink'

type Props = {
  companyName: string
  locale: Locale
  locales: Locale[]
  dictionary: Dictionary
}

export function SiteHeader({ companyName, locale, locales, dictionary }: Props) {
  const t = dictionary.nav
  const navItems = [
    { href: `/${locale}#services`, label: t.services },
    { href: `/${locale}#process`, label: t.process },
    { href: `/${locale}#contact`, label: t.contact },
  ]

  return (
    <header className="sticky top-0 z-40 border-b border-ivory/10 bg-ink/80 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-6 px-4 py-4 sm:px-8">
        <Link href={`/${locale}`} className="font-display text-xl tracking-wide text-ivory sm:text-2xl">
          {companyName}
        </Link>
        <nav aria-label={t.main} className="hidden items-center gap-8 md:flex">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="text-sm tracking-wide text-mist transition-colors hover:text-gold"
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-4">
          {locales.length > 1 && (
            <nav aria-label={t.language}>
              <ul className="flex items-center gap-2 text-xs tracking-wide uppercase">
                {locales.map((code) => (
                  <li key={code}>
                    <Link
                      href={`/${code}`}
                      hrefLang={code}
                      lang={code}
                      title={LOCALE_LABELS[code]}
                      aria-current={code === locale ? 'true' : undefined}
                      className={cn(
                        'transition-colors hover:text-gold',
                        code === locale ? 'text-gold' : 'text-mist',
                      )}
                    >
                      {code}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          )}
          <ButtonLink href={`/${locale}#contact`} className="px-5 py-2">
            {t.bookNow}
          </ButtonLink>
        </div>
      </div>
    </header>
  )
}
