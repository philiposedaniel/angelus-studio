import { describe, expect, it } from 'vitest'

import { getErrorText, localeFromPath } from '@/i18n/dictionaries/errors'

describe('error page text', () => {
  it('takes the language from the start of the path', () => {
    expect(localeFromPath('/es/events/open-day')).toBe('es')
    expect(localeFromPath('/fr')).toBe('fr')
  })

  it('uses English for paths without a language', () => {
    expect(localeFromPath('/admin')).toBe('en')
    expect(localeFromPath('/')).toBe('en')
    expect(localeFromPath(null)).toBe('en')
  })

  it('falls back to English for languages without a translation', () => {
    expect(getErrorText('fr')).toEqual(getErrorText('en'))
    expect(getErrorText('es').retry).toBe('Intentar de nuevo')
  })
})
