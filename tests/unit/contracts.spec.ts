import { describe, expect, it } from 'vitest'

import { contractRequired, contractSigned, signatureName, termsFingerprint } from '@/lib/contracts'

describe('contract signing', () => {
  it('needs the agreement box ticked and a real name', () => {
    expect(signatureName('Maria Silva', 'on')).toBe('Maria Silva')
    expect(signatureName('  Maria   Silva  ', 'on')).toBe('Maria Silva')
    expect(signatureName('Maria Silva', undefined)).toBeNull()
    expect(signatureName('Maria Silva', 'off')).toBeNull()
    expect(signatureName('M', 'on')).toBeNull()
    expect(signatureName('   ', 'on')).toBeNull()
    expect(signatureName('x'.repeat(121), 'on')).toBeNull()
    expect(signatureName(['Maria', 'Silva'], 'on')).toBeNull()
  })

  it('fingerprints the exact terms, so any edit changes it', () => {
    const terms = 'The photographer arrives at 08:00.'
    expect(termsFingerprint(terms)).toMatch(/^[0-9a-f]{64}$/)
    expect(termsFingerprint(terms)).toBe(termsFingerprint(terms))
    expect(termsFingerprint(`${terms} `)).not.toBe(termsFingerprint(terms))
  })

  it('treats blank terms as no contract, and a missing signature as unsigned', () => {
    expect(contractRequired({ terms: 'Full day coverage.' })).toBe(true)
    expect(contractRequired({ terms: '   ' })).toBe(false)
    expect(contractRequired({ terms: null })).toBe(false)
    expect(contractRequired(undefined)).toBe(false)
    expect(contractSigned({ signedAt: '2026-10-16T07:00:00.000Z' })).toBe(true)
    expect(contractSigned({ signedAt: null })).toBe(false)
    expect(contractSigned(undefined)).toBe(false)
  })
})
