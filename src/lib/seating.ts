import type { EventGuest, EventTable } from '@/payload-types'

import { idOf } from '@/lib/ids'

/** Most seats one table can have. */
export const MAX_TABLE_CAPACITY = 500

type SeatedGuest = Pick<EventGuest, 'id' | 'name' | 'table' | 'rsvpStatus' | 'attendingCount' | 'partySize'>

/**
 * Seats a guest's party needs at their table: the people coming once they have answered, every
 * seat on the invitation while they have not, and none once they have declined.
 */
export function seatsNeeded(guest: Pick<EventGuest, 'rsvpStatus' | 'attendingCount' | 'partySize'>): number {
  if (guest.rsvpStatus === 'declined') return 0
  if (guest.rsvpStatus === 'attending') return guest.attendingCount ?? 1
  return guest.partySize ?? 1
}

/** Each table with the guests seated at it, and the guests still without a table. */
export function summarizeSeating(
  tables: readonly Pick<EventTable, 'id' | 'name' | 'capacity'>[],
  guests: readonly SeatedGuest[],
) {
  const byTable = new Map(
    tables.map((table) => [
      String(table.id),
      { id: table.id, name: table.name, capacity: table.capacity ?? 0, seats: 0, guests: [] as SeatedGuest[] },
    ]),
  )
  const unseated: SeatedGuest[] = []
  let unseatedSeats = 0
  for (const guest of guests) {
    const seats = seatsNeeded(guest)
    const table = byTable.get(String(idOf(guest.table)))
    if (table) {
      table.guests.push(guest)
      table.seats += seats
    } else if (seats > 0) {
      // Guests who declined need no table, so they are not counted as waiting for one.
      unseated.push(guest)
      unseatedSeats += seats
    }
  }
  const rows = [...byTable.values()].map((table) => ({ ...table, over: table.seats > table.capacity }))
  return {
    tables: rows,
    capacity: rows.reduce((sum, table) => sum + table.capacity, 0),
    seated: rows.reduce((sum, table) => sum + table.seats, 0),
    unseated,
    unseatedSeats,
  }
}
