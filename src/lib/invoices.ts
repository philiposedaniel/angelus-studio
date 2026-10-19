import type { Payload } from 'payload'

/** Quote statuses an invoice is shown for: a quote the client has been sent and can read. */
export const INVOICE_STATUSES = ['sent', 'deposit-paid', 'paid-in-full'] as const

export type InvoicePayment = {
  kind?: string | null
  status?: string | null
  amount: number
  paidAt?: string | null
}

export type InvoiceTotals = {
  totalAmount: number
  depositAmount: number
  balanceAmount: number
  depositPaid: number
  balancePaid: number
  depositDue: number
  balanceDue: number
  amountDue: number
}

/**
 * Amounts on an invoice, in minor units. Only payments that have been confirmed as paid count;
 * a waiting, failed or expired payment changes nothing, and neither do ticket payments.
 */
export function invoiceTotals(
  quote: { totalAmount?: number | null; depositAmount?: number | null },
  payments: readonly InvoicePayment[],
): InvoiceTotals {
  const totalAmount = quote.totalAmount ?? 0
  const depositAmount = quote.depositAmount ?? 0
  const balanceAmount = totalAmount - depositAmount
  const paidOf = (kind: 'deposit' | 'balance' | 'installment') =>
    payments
      .filter((payment) => payment.kind === kind && payment.status === 'paid')
      .reduce((sum, payment) => sum + payment.amount, 0)
  const depositPaid = paidOf('deposit')
  // Installments of a payment schedule are paid towards the balance, the same as one balance payment.
  const balancePaid = paidOf('balance') + paidOf('installment')
  return {
    totalAmount,
    depositAmount,
    balanceAmount,
    depositPaid,
    balancePaid,
    depositDue: Math.max(depositAmount - depositPaid, 0),
    balanceDue: Math.max(balanceAmount - balancePaid, 0),
    amountDue: Math.max(totalAmount - depositPaid - balancePaid, 0),
  }
}

/**
 * The invoice for a quote, looked up by the quote's private link. The link's token and the
 * studio are both required: a token from another studio finds nothing. Payments are read only
 * for this quote and this studio.
 */
export async function loadInvoice(payload: Payload, tenantId: number, token: string) {
  const { docs } = await payload.find({
    collection: 'quotes',
    where: {
      and: [
        { tenant: { equals: tenantId } },
        { publicToken: { equals: token } },
        { status: { in: [...INVOICE_STATUSES] } },
      ],
    },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })
  const quote = docs[0]
  if (!quote) return null

  const { docs: payments } = await payload.find({
    collection: 'payments',
    where: {
      and: [
        { tenant: { equals: tenantId } },
        { quote: { equals: quote.id } },
        { status: { equals: 'paid' } },
      ],
    },
    sort: 'paidAt',
    limit: 100,
    depth: 0,
    overrideAccess: true,
  })

  return { quote, payments, totals: invoiceTotals(quote, payments) }
}
