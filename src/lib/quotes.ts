const DAY_MS = 24 * 60 * 60 * 1000

/** A quote is valid through the whole of its last day. Empty means no limit. */
export const isQuoteExpired = (validUntil: string | null | undefined, now = Date.now()) =>
  validUntil ? new Date(validUntil).getTime() + DAY_MS <= now : false

/** Statuses after the deposit has been paid: the production is booked. */
export const PAID_QUOTE_STATUSES = ['deposit-paid', 'paid-in-full'] as const

/** What the client still owes after the deposit, in minor units. */
export const balanceAmount = (quote: { totalAmount?: number | null; depositAmount?: number | null }) =>
  (quote.totalAmount ?? 0) - (quote.depositAmount ?? 0)
