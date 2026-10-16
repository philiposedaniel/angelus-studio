import { describe, expect, it } from 'vitest'

import { seatsNeeded, summarizeSeating } from '@/lib/seating'

describe('seatsNeeded', () => {
  it('counts who is coming, every seat while unanswered, and none after a decline', () => {
    expect(seatsNeeded({ rsvpStatus: 'attending', attendingCount: 2, partySize: 4 })).toBe(2)
    expect(seatsNeeded({ rsvpStatus: 'pending', attendingCount: 0, partySize: 3 })).toBe(3)
    expect(seatsNeeded({ rsvpStatus: 'declined', attendingCount: 0, partySize: 3 })).toBe(0)
  })
})

describe('summarizeSeating', () => {
  it('fills tables, flags one over capacity and lists guests without a table', () => {
    const plan = summarizeSeating(
      [
        { id: 1, name: 'Table 1', capacity: 4 },
        { id: 2, name: 'Head table', capacity: 2 },
      ],
      [
        { id: 10, name: 'Ana', table: 1, rsvpStatus: 'attending', attendingCount: 2, partySize: 2 },
        { id: 11, name: 'Rui', table: 2, rsvpStatus: 'pending', attendingCount: 0, partySize: 3 },
        { id: 12, name: 'Eva', table: null, rsvpStatus: 'attending', attendingCount: 1, partySize: 2 },
        { id: 13, name: 'Leo', table: null, rsvpStatus: 'declined', attendingCount: 0, partySize: 2 },
      ],
    )
    expect(plan.capacity).toBe(6)
    expect(plan.seated).toBe(5)
    expect(plan.tables.map((t) => [t.name, t.seats, t.over])).toEqual([
      ['Table 1', 2, false],
      ['Head table', 3, true],
    ])
    expect(plan.unseated.map((g) => g.name)).toEqual(['Eva'])
    expect(plan.unseatedSeats).toBe(1)
  })
})
