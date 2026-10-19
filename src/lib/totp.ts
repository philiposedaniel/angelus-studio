import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

/**
 * Time-based one-time codes (RFC 6238) for staff sign-in, with the HOTP step from RFC 4226.
 * Uses only Node's crypto module: SHA-1, 30-second steps and six digits, which is what
 * authenticator apps expect. Secrets are base32, as the apps display them.
 */

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
export const TOTP_STEP_SECONDS = 30
export const TOTP_DIGITS = 6

export const base32Encode = (bytes: Uint8Array): string => {
  let bits = 0
  let value = 0
  let output = ''
  for (const byte of bytes) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      output += BASE32[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) output += BASE32[(value << (5 - bits)) & 31]
  return output
}

export const base32Decode = (text: string): Buffer => {
  const clean = text.replace(/[\s=]/g, '').toUpperCase()
  let bits = 0
  let value = 0
  const bytes: number[] = []
  for (const character of clean) {
    const index = BASE32.indexOf(character)
    if (index < 0) throw new Error('Not a base32 secret.')
    value = (value << 5) | index
    bits += 5
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255)
      bits -= 8
    }
  }
  return Buffer.from(bytes)
}

/** A new secret: 20 random bytes, which is the length the RFC recommends for SHA-1. */
export const generateTotpSecret = (): string => base32Encode(randomBytes(20))

/** The one-time code for one counter value. */
export const hotp = (secret: Buffer, counter: number): string => {
  const message = Buffer.alloc(8)
  message.writeBigUInt64BE(BigInt(counter))
  const digest = createHmac('sha1', secret).update(message).digest()
  const offset = digest[digest.length - 1]! & 0x0f
  const binary =
    ((digest[offset]! & 0x7f) << 24) |
    ((digest[offset + 1]! & 0xff) << 16) |
    ((digest[offset + 2]! & 0xff) << 8) |
    (digest[offset + 3]! & 0xff)
  return String(binary % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, '0')
}

/** The step counter for a moment in time, in seconds since the epoch divided by the step. */
export const totpCounter = (at: Date) => Math.floor(at.getTime() / 1000 / TOTP_STEP_SECONDS)

/**
 * Checks a code against the current step and the steps either side of it, to allow for clock drift.
 * Returns the matching counter, or null. Counters at or below `lastCounter` are refused, so a code
 * cannot be used twice.
 */
export function verifyTotp(
  secret: string,
  code: string,
  options: { at?: Date; lastCounter?: number | null; window?: number } = {},
): number | null {
  const normalized = code.replace(/\s/g, '')
  if (!new RegExp(`^\\d{${TOTP_DIGITS}}$`).test(normalized)) return null
  const key = base32Decode(secret)
  const now = totpCounter(options.at ?? new Date())
  const window = options.window ?? 1
  const last = options.lastCounter ?? -Infinity
  const given = Buffer.from(normalized)
  let matched: number | null = null
  for (let counter = Math.max(0, now - window); counter <= now + window; counter += 1) {
    const expected = Buffer.from(hotp(key, counter))
    if (timingSafeEqual(given, expected) && counter > last) matched = counter
  }
  return matched
}

/** The address an authenticator app reads from a QR code or a typed setup key. */
export const totpUri = ({ secret, account, issuer }: { secret: string; account: string; issuer: string }) => {
  // The colon between issuer and account separates them in the label, so it stays unencoded.
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    period: String(TOTP_STEP_SECONDS),
  })
  return `otpauth://totp/${label}?${params.toString()}`
}
