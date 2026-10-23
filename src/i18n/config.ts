/**
 * Languages the platform supports. English is the default and the fallback. Each studio
 * (tenant) chooses which of these its public website offers.
 *
 * Adding a language: add its code and label here, optionally add a dictionary in
 * ./dictionaries (interface text falls back to English until then), then translate CMS
 * content in the admin. Right-to-left languages also need layout work before being added.
 */
export const LOCALES = ['en', 'es', 'fr', 'pt', 'de', 'it'] as const
export type Locale = (typeof LOCALES)[number]

export const DEFAULT_LOCALE: Locale = 'en'

/** Request header the proxy sets to the language in the URL, for pages that get no route params. */
export const LOCALE_HEADER = 'x-site-locale'

/** Request header the proxy sets to the requested path and query, so a page can redirect to itself. */
export const PATH_HEADER = 'x-site-path'

export const LOCALE_LABELS: Record<Locale, string> = {
  en: 'English',
  es: 'Español',
  fr: 'Français',
  pt: 'Português',
  de: 'Deutsch',
  it: 'Italiano',
}

export const isLocale = (value: string | null | undefined): value is Locale =>
  !!value && (LOCALES as readonly string[]).includes(value)

/** Picks the best of `available` locales from an Accept-Language header. */
export function negotiateLocale(
  acceptLanguage: string | null | undefined,
  available: readonly Locale[] = LOCALES,
  fallback: Locale = DEFAULT_LOCALE,
): Locale {
  const offered = (value: string | undefined): value is Locale =>
    isLocale(value) && available.includes(value)
  if (!acceptLanguage) return fallback
  const ranked = acceptLanguage
    .split(',')
    .map((part) => {
      const [tag = '', ...params] = part.trim().split(';')
      const q = params.find((p) => p.trim().startsWith('q='))
      return { tag: tag.toLowerCase(), q: q ? Number(q.trim().slice(2)) || 0 : 1 }
    })
    .filter((entry) => entry.tag && entry.q > 0)
    .sort((a, b) => b.q - a.q)
  for (const { tag } of ranked) {
    const base = tag.split('-')[0]
    if (offered(tag)) return tag
    if (offered(base)) return base
  }
  return fallback
}

/**
 * The same page in another language: `/pt/invite/abc` becomes `/en/invite/abc`. Anything that
 * is not a path under `from`, or would leave the site, becomes the home page in `to`.
 */
export function pathInLocale(path: string | null | undefined, from: Locale, to: Locale): string {
  const prefix = `/${from}`
  if (!path || !(path === prefix || path.startsWith(`${prefix}/`) || path.startsWith(`${prefix}?`))) return `/${to}`
  const rest = path.slice(prefix.length)
  // "//host" or a backslash would make the browser leave for another site.
  if (rest.startsWith('//') || rest.includes('\\')) return `/${to}`
  return `/${to}${rest}`
}
