import crypto from 'crypto'

/** Share links carry 32 random URL-safe characters (192 bits), so they cannot be guessed. */
export const newShareToken = () => crypto.randomBytes(24).toString('base64url')

export const isShareToken = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9_-]{32}$/.test(value)

/** Web-size copies a share link may serve. Originals are never shared this way. */
export const SHARED_SIZES = ['thumbnail', 'web'] as const
export type SharedSize = (typeof SHARED_SIZES)[number]
export const isSharedSize = (value: string): value is SharedSize =>
  (SHARED_SIZES as readonly string[]).includes(value)
