import { describe, expect, it } from 'vitest'

import { PRIVATE_PATHS, siteOrigin } from '@/lib/seo'

describe('siteOrigin', () => {
  it('uses https for a studio domain', () => {
    expect(siteOrigin({ domain: 'angelusmedia.com' })).toBe('https://angelusmedia.com')
  })

  it('uses http for a local host, with its port', () => {
    expect(siteOrigin({ domain: 'localhost:3000' })).toBe('http://localhost:3000')
  })

  it('returns null without a domain', () => {
    expect(siteOrigin({ domain: null })).toBeNull()
    expect(siteOrigin({ domain: '  ' })).toBeNull()
  })
})

describe('PRIVATE_PATHS', () => {
  it('keeps client, guest and token pages out of robots-indexed paths', () => {
    expect(PRIVATE_PATHS).toEqual(
      expect.arrayContaining(['/*/portal', '/*/quote/', '/*/invite/', '/*/events/*/guests/', '/s/']),
    )
  })
})
