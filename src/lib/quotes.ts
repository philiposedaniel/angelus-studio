const DAY_MS = 24 * 60 * 60 * 1000

/** A quote is valid through the whole of its last day. Empty means no limit. */
export const isQuoteExpired = (validUntil: string | null | undefined, now = Date.now()) =>
  validUntil ? new Date(validUntil).getTime() + DAY_MS <= now : false
