import { NextResponse, type NextRequest } from 'next/server'

import { isLocale, LOCALE_HEADER, negotiateLocale, PATH_HEADER } from '@/i18n/config'

/**
 * Sends public pages without a language prefix to the visitor's preferred language.
 * The page layout then checks the language is one the studio offers.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl
  const first = pathname.split('/')[1]
  if (isLocale(first)) {
    // Not-found pages get no route params, so they read the language from this header.
    const headers = new Headers(request.headers)
    headers.set(LOCALE_HEADER, first)
    // A page in a language the studio does not offer redirects to itself in one it does.
    headers.set(PATH_HEADER, `${pathname}${request.nextUrl.search}`)
    return NextResponse.next({ request: { headers } })
  }

  const locale = negotiateLocale(request.headers.get('accept-language'))
  const url = request.nextUrl.clone()
  url.pathname = `/${locale}${pathname === '/' ? '' : pathname}`
  return NextResponse.redirect(url)
}

export const config = {
  // Skip the admin panel, API, health check, share links (/s/…, language chosen by the page),
  // Next internals and files with an extension.
  matcher: ['/((?!admin|api|healthz|s/|_next|.*\\..*).*)'],
}
