/**
 * A quote's balance can be paid in dated installments instead of one payment. The schedule is a list
 * of { dueDate, amount } rows in minor units; their amounts must add up to the balance exactly.
 * An empty schedule means the balance is paid in one payment, as before.
 */

/** The most installments a quote can carry. */
export const MAX_INSTALLMENTS = 12

export type ScheduleRow = { dueDate?: string | null; amount?: number | null }

export type ScheduleProblem = 'count' | 'amount' | 'total' | 'date' | 'order'

/** Why a schedule cannot be saved for this balance, or null when it can. */
export function scheduleProblem(
  schedule: readonly ScheduleRow[] | null | undefined,
  balance: number,
): ScheduleProblem | null {
  if (!schedule || schedule.length === 0) return null
  if (schedule.length > MAX_INSTALLMENTS) return 'count'
  let total = 0
  let previous = Number.NEGATIVE_INFINITY
  for (const row of schedule) {
    const { amount, dueDate } = row
    if (typeof amount !== 'number' || !Number.isInteger(amount) || amount <= 0) return 'amount'
    const time = dueDate ? Date.parse(dueDate) : Number.NaN
    if (Number.isNaN(time)) return 'date'
    if (time < previous) return 'order'
    previous = time
    total += amount
  }
  return total === balance ? null : 'total'
}

/** The installment numbers of a schedule, from 1 to the number of rows. */
export function installmentNumbers(schedule: readonly ScheduleRow[] | null | undefined): number[] {
  return (schedule ?? []).map((_, index) => index + 1)
}

/**
 * The installment numbers that a quote still needs paid, given the numbers already paid. A schedule
 * is finished once every installment has been paid.
 */
export function unpaidInstallments(
  schedule: readonly ScheduleRow[] | null | undefined,
  paidNumbers: ReadonlySet<number>,
): number[] {
  return installmentNumbers(schedule).filter((number) => !paidNumbers.has(number))
}
