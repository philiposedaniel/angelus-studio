import { describe, expect, it } from 'vitest'

import { monthBounds, parseMonth, shiftMonth } from '@/lib/calendar'

describe('production calendar months', () => {
  const now = new Date('2026-10-16T07:00:00.000Z')

  it('reads YYYY-MM and falls back to the current month for anything else', () => {
    expect(parseMonth('2026-11', now)).toEqual({ year: 2026, month: 11, value: '2026-11' })
    expect(parseMonth(undefined, now).value).toBe('2026-10')
    expect(parseMonth('2026-13', now).value).toBe('2026-10')
    expect(parseMonth('2026-1', now).value).toBe('2026-10')
    expect(parseMonth(['2026-11'], now).value).toBe('2026-10')
  })

  it('moves across year ends', () => {
    expect(shiftMonth({ year: 2026, month: 12, value: '2026-12' }, 1).value).toBe('2027-01')
    expect(shiftMonth({ year: 2027, month: 1, value: '2027-01' }, -1).value).toBe('2026-12')
  })

  it('covers the whole month, with an exclusive end', () => {
    const bounds = monthBounds({ year: 2026, month: 2, value: '2026-02' })
    expect(bounds.start).toBe('2026-02-01T00:00:00.000Z')
    expect(bounds.end).toBe('2026-03-01T00:00:00.000Z')
  })
})
