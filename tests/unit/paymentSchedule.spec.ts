import { describe, expect, it } from 'vitest'

import { MAX_INSTALLMENTS, scheduleProblem, unpaidInstallments } from '@/lib/paymentSchedule'
import { invoiceTotals } from '@/lib/invoices'

const row = (dueDate: string, amount: number) => ({ dueDate, amount })

describe('payment schedule', () => {
  it('accepts no schedule, which means the balance is paid at once', () => {
    expect(scheduleProblem(undefined, 14000)).toBeNull()
    expect(scheduleProblem([], 14000)).toBeNull()
  })

  it('accepts installments that add up to the balance exactly, in due-date order', () => {
    expect(scheduleProblem([row('2026-11-15', 7000), row('2026-12-15', 7000)], 14000)).toBeNull()
  })

  it('reports a total that is off by a single minor unit', () => {
    expect(scheduleProblem([row('2026-11-15', 7000), row('2026-12-15', 6999)], 14000)).toBe('total')
  })

  it('reports amounts that are not whole and positive', () => {
    expect(scheduleProblem([row('2026-11-15', 7000.5), row('2026-12-15', 6999.5)], 14000)).toBe('amount')
    expect(scheduleProblem([row('2026-11-15', 0), row('2026-12-15', 14000)], 14000)).toBe('amount')
  })

  it('reports a missing or unreadable due date', () => {
    expect(scheduleProblem([row('', 7000), row('2026-12-15', 7000)], 14000)).toBe('date')
    expect(scheduleProblem([row('not a date', 7000), row('2026-12-15', 7000)], 14000)).toBe('date')
  })

  it('reports installments that are out of due-date order', () => {
    expect(scheduleProblem([row('2026-12-15', 7000), row('2026-11-15', 7000)], 14000)).toBe('order')
  })

  it('allows the most installments a quote can carry and refuses one more', () => {
    const rows = (count: number) =>
      Array.from({ length: count }, (_, index) =>
        row(`2026-${String(index + 1).padStart(2, '0')}-01`, index === 0 ? 2000 : 1000),
      )
    // Twelve rows totalling 13000 in date order are the most a quote can carry.
    expect(scheduleProblem(rows(MAX_INSTALLMENTS), 13000)).toBeNull()
    expect(scheduleProblem(rows(MAX_INSTALLMENTS + 1), 14000)).toBe('count')
  })

  it('lists the installments still to pay, numbered from 1', () => {
    const schedule = [row('2026-11-15', 7000), row('2026-12-15', 7000), row('2027-01-15', 7000)]
    expect(unpaidInstallments(schedule, new Set([1]))).toEqual([2, 3])
    expect(unpaidInstallments(schedule, new Set([1, 2, 3]))).toEqual([])
    expect(unpaidInstallments(undefined, new Set())).toEqual([])
  })
})

describe('invoice totals with installments', () => {
  it('counts paid installments towards the balance, and only paid ones', () => {
    const totals = invoiceTotals({ totalAmount: 20000, depositAmount: 6000 }, [
      { kind: 'deposit', status: 'paid', amount: 6000 },
      { kind: 'installment', status: 'paid', amount: 7000 },
      { kind: 'installment', status: 'pending', amount: 7000 },
    ])
    expect(totals.balancePaid).toBe(7000)
    expect(totals.amountDue).toBe(7000)
  })
})
