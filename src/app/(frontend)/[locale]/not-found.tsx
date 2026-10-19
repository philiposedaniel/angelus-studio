import { headers } from 'next/headers'

import { ButtonLink } from '@/components/ButtonLink'
import { DEFAULT_LOCALE, isLocale, LOCALE_HEADER } from '@/i18n/config'
import { getDictionary } from '@/i18n/dictionaries'

/** A missing page inside the website, shown with the site's header and footer in the visitor's language. */
export default async function NotFound() {
  const requested = (await headers()).get(LOCALE_HEADER)
  const locale = isLocale(requested) ? requested : DEFAULT_LOCALE
  const t = getDictionary(locale).notFoundPage
  return (
    <section className="mx-auto flex max-w-xl flex-col items-center px-6 py-32 text-center">
      <h1 className="font-display text-4xl sm:text-5xl">{t.title}</h1>
      <p className="mt-4 text-mist">{t.text}</p>
      <ButtonLink href={`/${locale}`} className="mt-10">
        {t.home}
      </ButtonLink>
    </section>
  )
}
