import { describe, expect, it } from 'vitest'

import { invoiceTotals, type InvoicePayment } from '@/lib/invoices'

const quote = { totalAmount: 100000, depositAmount: 30000 }

const payment = (overrides: Partial<InvoicePayment>): InvoicePayment => ({
  kind: 'deposit',
  status: 'paid',
  amount: 30000,
  paidAt: '2026-10-17T10:00:00.000Z',
  ...overrides,
})

describe('invoiceTotals', () => {
  it('shows the deposit as due before anything is paid', () => {
    expect(invoiceTotals(quote, [])).toEqual({
      totalAmount: 100000,
      depositAmount: 30000,
      balanceAmount: 70000,
      depositPaid: 0,
      balancePaid: 0,
      depositDue: 30000,
      balanceDue: 70000,
      amountDue: 100000,
    })
  })

  it('counts a paid deposit and leaves the balance due', () => {
    const totals = invoiceTotals(quote, [payment({})])
    expect(totals.depositPaid).toBe(30000)
    expect(totals.depositDue).toBe(0)
    expect(totals.amountDue).toBe(70000)
  })

  it('clears the amount due once the balance is paid too', () => {
    const totals = invoiceTotals(quote, [payment({}), payment({ kind: 'balance', amount: 70000 })])
    expect(totals.balancePaid).toBe(70000)
    expect(totals.balanceDue).toBe(0)
    expect(totals.amountDue).toBe(0)
  })

  it('ignores payments that are not confirmed as paid', () => {
    const totals = invoiceTotals(quote, [
      payment({ status: 'pending' }),
      payment({ status: 'failed' }),
      payment({ status: 'expired' }),
    ])
    expect(totals.depositPaid).toBe(0)
    expect(totals.amountDue).toBe(100000)
  })

  it('ignores ticket payments, which belong to an event registration', () => {
    const totals = invoiceTotals(quote, [payment({ kind: 'ticket', amount: 5000 })])
    expect(totals.depositPaid).toBe(0)
    expect(totals.balancePaid).toBe(0)
  })

  it('never shows a negative amount due when more has been paid than the total', () => {
    const totals = invoiceTotals(quote, [payment({ amount: 30000 }), payment({ kind: 'balance', amount: 80000 })])
    expect(totals.amountDue).toBe(0)
    expect(totals.balanceDue).toBe(0)
  })

  it('treats a missing total or deposit as zero', () => {
    const totals = invoiceTotals({ totalAmount: null, depositAmount: undefined }, [])
    expect(totals.totalAmount).toBe(0)
    expect(totals.amountDue).toBe(0)
  })
})
