import { describe, expect, it } from 'vitest'

import { dayIn, dayStatus } from '@/lib/availability'

describe('dayIn', () => {
  it('gives the day in the event\'s time zone, which can differ from the UTC day', () => {
    // 23:30 UTC on 31 October is 08:30 on 1 November in Tokyo.
    expect(dayIn('2026-10-31T23:30:00.000Z', 'Asia/Tokyo')).toBe('2026-11-01')
    expect(dayIn('2026-10-31T23:30:00.000Z', 'UTC')).toBe('2026-10-31')
  })

  it('keeps the same day for a moment well inside it', () => {
    expect(dayIn('2026-11-15T12:00:00.000Z', 'Europe/Lisbon')).toBe('2026-11-15')
  })
})

describe('dayStatus', () => {
  const booked = new Set(['2026-10-25'])

  it('shows a day before today as past, even when it is free', () => {
    expect(dayStatus('2026-10-20', '2026-10-21', booked)).toBe('past')
  })

  it('shows today and later as booked or free', () => {
    expect(dayStatus('2026-10-21', '2026-10-21', booked)).toBe('open')
    expect(dayStatus('2026-10-25', '2026-10-21', booked)).toBe('booked')
    expect(dayStatus('2026-10-26', '2026-10-21', booked)).toBe('open')
  })

  it('keeps a past booked day as past', () => {
    expect(dayStatus('2026-10-25', '2026-10-30', booked)).toBe('past')
  })
})
