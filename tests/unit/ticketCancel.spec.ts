import { describe, expect, it } from 'vitest'

import { ticketCancelCheck } from '@/lib/tickets'

const NOW = Date.parse('2027-06-01T12:00:00Z')
const event = { startsAt: '2027-06-12T15:00:00Z' }
const free = { status: 'confirmed' as const, amount: 0, checkedInCount: 0 }

describe('ticketCancelCheck', () => {
  it('lets a holder cancel a confirmed free registration before the event', () => {
    expect(ticketCancelCheck(free, event, NOW)).toBe('allowed')
    expect(ticketCancelCheck({ ...free, amount: null, checkedInCount: null }, event, NOW)).toBe('allowed')
  })

  it('says why it cannot', () => {
    expect(ticketCancelCheck({ ...free, status: 'pending' }, event, NOW)).toBe('notConfirmed')
    expect(ticketCancelCheck({ ...free, status: 'cancelled' }, event, NOW)).toBe('notConfirmed')
    expect(ticketCancelCheck({ ...free, amount: 1500 }, event, NOW)).toBe('paid')
    expect(ticketCancelCheck({ ...free, checkedInCount: 1 }, event, NOW)).toBe('checkedIn')
    expect(ticketCancelCheck(free, event, Date.parse(event.startsAt))).toBe('started')
  })
})
