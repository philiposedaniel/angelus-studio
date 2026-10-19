import { describe, expect, it } from 'vitest'

import { base32Decode, base32Encode, generateTotpSecret, hotp, totpUri, verifyTotp } from '@/lib/totp'

// RFC 6238 appendix B, SHA-1, secret "12345678901234567890". The RFC gives eight digits; these are the last six.
const RFC_SECRET = Buffer.from('12345678901234567890')
const vectors: Array<[number, string]> = [
  [59, '287082'],
  [1111111109, '081804'],
  [1111111111, '050471'],
  [1234567890, '005924'],
  [2000000000, '279037'],
]

describe('time-based codes', () => {
  it('matches the RFC 6238 SHA-1 test vectors', () => {
    for (const [seconds, code] of vectors) {
      const counter = Math.floor(seconds / 30)
      expect(hotp(RFC_SECRET, counter)).toBe(code)
    }
  })

  it('round-trips base32 and generates 32-character secrets', () => {
    const bytes = Buffer.from('hello, staff')
    expect(base32Decode(base32Encode(bytes)).toString()).toBe('hello, staff')
    expect(generateTotpSecret()).toMatch(/^[A-Z2-7]{32}$/)
  })

  it('accepts the current step and one step either side, but nothing further away', () => {
    const secret = base32Encode(RFC_SECRET)
    const at = new Date(59 * 1000)
    expect(verifyTotp(secret, '287082', { at })).toBe(1)
    expect(verifyTotp(secret, '287082', { at: new Date(89 * 1000) })).toBe(1)
    expect(verifyTotp(secret, '287082', { at: new Date(149 * 1000) })).toBeNull()
  })

  it('refuses a code whose step has already been used, so it cannot be replayed', () => {
    const secret = base32Encode(RFC_SECRET)
    const at = new Date(59 * 1000)
    expect(verifyTotp(secret, '287082', { at, lastCounter: 1 })).toBeNull()
    expect(verifyTotp(secret, '287082', { at, lastCounter: 0 })).toBe(1)
  })

  it('refuses anything that is not six digits', () => {
    const secret = base32Encode(RFC_SECRET)
    const at = new Date(59 * 1000)
    expect(verifyTotp(secret, '28708', { at })).toBeNull()
    expect(verifyTotp(secret, 'abcdef', { at })).toBeNull()
    expect(verifyTotp(secret, '287 082', { at })).toBe(1)
  })

  it('builds an authenticator link with issuer, account and the standard parameters', () => {
    const uri = totpUri({ secret: 'ABC', account: 'staff@example.com', issuer: 'Angelus Studio' })
    expect(uri).toBe(
      'otpauth://totp/Angelus%20Studio:staff%40example.com?secret=ABC&issuer=Angelus+Studio&algorithm=SHA1&digits=6&period=30',
    )
  })
})
