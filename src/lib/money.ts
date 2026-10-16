/**
 * Money is stored as integers in the currency's minor unit (cents, centavos), never as
 * decimals. Every currency offered here has two decimal places; add a currency with a
 * different number of decimals only after changing `formatMoney` to match.
 */
export const CURRENCIES = ['eur', 'usd', 'gbp'] as const
export type Currency = (typeof CURRENCIES)[number]

export const CURRENCY_LABELS: Record<Currency, string> = {
  eur: 'Euro (EUR)',
  usd: 'US dollar (USD)',
  gbp: 'Pound sterling (GBP)',
}

export const MAX_QUANTITY = 1000
export const MAX_AMOUNT = 100_000_000 // 1,000,000.00 in the minor unit

export type LineItem = { quantity: number; unitAmount: number }

/** Total of the line items, and the deposit due now, both in minor units. */
export function quoteTotals(
  lineItems: readonly LineItem[],
  depositPercent: number,
): { totalAmount: number; depositAmount: number } {
  const totalAmount = lineItems.reduce((sum, item) => sum + item.quantity * item.unitAmount, 0)
  // Rounds to the nearest minor unit, half up, so the deposit never depends on floating point.
  const depositAmount = Math.round((totalAmount * depositPercent) / 100)
  return { totalAmount, depositAmount }
}

/** Formats an amount in minor units for display, for example 12550 EUR as "€125.50". */
export function formatMoney(amountMinor: number, currency: string, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: currency.toUpperCase(),
  }).format(amountMinor / 100)
}
