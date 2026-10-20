import { describe, expect, it } from 'vitest'

import { invoiceTotals, type InvoicePayment, scheduleLines } from '@/lib/invoices'

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

describe('scheduleLines', () => {
  const schedule = [
    { dueDate: '2026-11-15T00:00:00.000Z', amount: 7000 },
    { dueDate: '2026-12-15T00:00:00.000Z', amount: 7000 },
  ]

  it('lists every installment in order, with no paid day while it is still waiting', () => {
    expect(scheduleLines(schedule, [])).toEqual([
      { number: 1, dueDate: '2026-11-15T00:00:00.000Z', amount: 7000, paidAt: null },
      { number: 2, dueDate: '2026-12-15T00:00:00.000Z', amount: 7000, paidAt: null },
    ])
  })

  it('gives an installment the day it was paid, and leaves the others due', () => {
    const lines = scheduleLines(schedule, [
      { kind: 'installment', status: 'paid', installmentNumber: 1, amount: 7000, paidAt: '2026-11-16T10:00:00.000Z' },
    ])
    expect(lines.map((line) => line.paidAt)).toEqual(['2026-11-16T10:00:00.000Z', null])
  })

  it('ignores a waiting or failed installment payment', () => {
    const lines = scheduleLines(schedule, [
      { kind: 'installment', status: 'pending', installmentNumber: 2, amount: 7000, paidAt: null },
    ])
    expect(lines[1]?.paidAt).toBeNull()
  })

  it('is empty for a quote without a schedule', () => {
    expect(scheduleLines(undefined, [])).toEqual([])
    expect(scheduleLines([], [])).toEqual([])
  })
})

