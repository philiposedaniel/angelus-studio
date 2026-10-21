import { describe, expect, it } from 'vitest'

import { pathInLocale } from '@/i18n/config'

describe('pathInLocale', () => {
  it('keeps the page and its query, in the other language', () => {
    expect(pathInLocale('/pt/invite/abc123', 'pt', 'en')).toBe('/en/invite/abc123')
    expect(pathInLocale('/pt/tickets/abc/check-in?x=1', 'pt', 'es')).toBe('/es/tickets/abc/check-in?x=1')
    expect(pathInLocale('/pt', 'pt', 'en')).toBe('/en')
    expect(pathInLocale('/pt?q=1', 'pt', 'en')).toBe('/en?q=1')
  })

  it('goes home when the path is missing or not under that language', () => {
    expect(pathInLocale(null, 'pt', 'en')).toBe('/en')
    expect(pathInLocale('/es/invite/abc', 'pt', 'en')).toBe('/en')
    expect(pathInLocale('/ptx/invite', 'pt', 'en')).toBe('/en')
  })

  it('never leaves the site', () => {
    expect(pathInLocale('/pt//evil.example/x', 'pt', 'en')).toBe('/en')
    expect(pathInLocale('/pt/\\evil.example', 'pt', 'en')).toBe('/en')
  })
})
