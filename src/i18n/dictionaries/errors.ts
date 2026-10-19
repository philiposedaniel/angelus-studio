import { DEFAULT_LOCALE, isLocale, type Locale } from '../config'

/**
 * Text for the pages shown when something breaks. Kept apart from the full dictionaries because
 * error pages run in the browser and would otherwise send every visitor all of the site's text.
 * Languages without an entry use English.
 */
export type ErrorText = {
  title: string
  text: string
  retry: string
  home: string
  /** Precedes the code that matches the error in the server's log. */
  reference: string
}

const errorTexts: Partial<Record<Locale, ErrorText>> = {
  en: {
    title: 'Something went wrong',
    text: 'This page could not be loaded just now. Please try again in a moment.',
    retry: 'Try again',
    home: 'Back to the home page',
    reference: 'Reference',
  },
  es: {
    title: 'Algo salió mal',
    text: 'No se pudo cargar esta página en este momento. Inténtalo de nuevo en unos instantes.',
    retry: 'Intentar de nuevo',
    home: 'Volver a la página de inicio',
    reference: 'Referencia',
  },
}

/** The language a path starts with (`/es/events/…` gives `es`), or the default language. */
export function localeFromPath(pathname: string | null | undefined): Locale {
  const first = pathname?.split('/')[1]
  return isLocale(first) ? first : DEFAULT_LOCALE
}

export const getErrorText = (locale: Locale): ErrorText =>
  errorTexts[locale] ?? (errorTexts.en as ErrorText)
