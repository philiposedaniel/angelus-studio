import { describe, expect, it } from 'vitest'

import { formatMoney, quoteTotals } from '@/lib/money'
import { isQuoteExpired } from '@/lib/quotes'

describe('quote totals', () => {
  it('adds quantity times unit price in minor units', () => {
    expect(
      quoteTotals(
        [
          { quantity: 2, unitAmount: 5000 },
          { quantity: 1, unitAmount: 2550 },
        ],
        30,
      ),
    ).toEqual({ totalAmount: 12550, depositAmount: 3765 })
  })

  it('rounds the deposit to the nearest minor unit, half up', () => {
    // 1001 * 30% = 300.3 -> 300; 1005 * 50% = 502.5 -> 503
    expect(quoteTotals([{ quantity: 1, unitAmount: 1001 }], 30).depositAmount).toBe(300)
    expect(quoteTotals([{ quantity: 1, unitAmount: 1005 }], 50).depositAmount).toBe(503)
  })

  it('takes no deposit at 0% and the whole total at 100%', () => {
    expect(quoteTotals([{ quantity: 3, unitAmount: 1000 }], 0).depositAmount).toBe(0)
    expect(quoteTotals([{ quantity: 3, unitAmount: 1000 }], 100).depositAmount).toBe(3000)
  })

  it('has no total for no items', () => {
    expect(quoteTotals([], 30)).toEqual({ totalAmount: 0, depositAmount: 0 })
  })
})

describe('money display', () => {
  it('shows minor units as the currency, in the language asked for', () => {
    expect(formatMoney(12550, 'eur', 'en')).toBe('€125.50')
    expect(formatMoney(12550, 'usd', 'en')).toBe('$125.50')
  })
})

describe('quote expiry', () => {
  const now = Date.parse('2026-10-15T12:00:00Z')

  it('never expires without a date', () => {
    expect(isQuoteExpired(null, now)).toBe(false)
    expect(isQuoteExpired(undefined, now)).toBe(false)
  })

  it('stays valid through its last day, then expires', () => {
    expect(isQuoteExpired('2026-10-15T00:00:00.000Z', now)).toBe(false)
    expect(isQuoteExpired('2026-10-14T00:00:00.000Z', now)).toBe(true)
  })
})
