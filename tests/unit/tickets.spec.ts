import { describe, expect, it } from 'vitest'

import { salesState, summarizeTickets, validateRegistration } from '@/lib/tickets'

const NOW = Date.parse('2027-05-01T12:00:00Z')
const event = { startsAt: '2027-06-12T15:00:00Z', endsAt: '2027-06-12T23:00:00Z' }
const ticket = { onSale: true, salesStart: null, salesEnd: null, capacity: 10 }

const form = (values: Record<string, string>) => {
  const data = new FormData()
  for (const [key, value] of Object.entries(values)) data.set(key, value)
  return data
}

describe('salesState', () => {
  it('is on sale until the places run out', () => {
    expect(salesState(ticket, event, 9, NOW)).toBe('onSale')
    expect(salesState(ticket, event, 10, NOW)).toBe('soldOut')
  })

  it('follows the sales window, and closes when the event ends', () => {
    expect(salesState({ ...ticket, salesStart: '2027-05-02T00:00:00Z' }, event, 0, NOW)).toBe('notYet')
    expect(salesState({ ...ticket, salesEnd: '2027-04-30T00:00:00Z' }, event, 0, NOW)).toBe('ended')
    expect(salesState(ticket, event, 0, Date.parse('2027-06-13T00:00:00Z'))).toBe('ended')
    expect(salesState(ticket, { startsAt: '2027-04-01T00:00:00Z' }, 0, NOW)).toBe('ended')
  })

  it('is closed when staff take it off sale', () => {
    expect(salesState({ ...ticket, onSale: false }, event, 0, NOW)).toBe('closed')
  })
})

describe('validateRegistration', () => {
  it('accepts a complete form and tidies the email', () => {
    const result = validateRegistration(
      form({ ticketType: '4', quantity: '2', name: ' Ana ', email: 'Ana@Example.com', consent: 'on' }),
    )
    expect(result).toEqual({ ok: true, input: { ticketType: 4, quantity: 2, name: 'Ana', email: 'ana@example.com' } })
  })

  it('names each problem', () => {
    const result = validateRegistration(form({ ticketType: 'x', quantity: '0', phone: 'abc' }))
    expect(result).toEqual({
      ok: false,
      errors: { ticketType: 'required', quantity: 'invalid', name: 'required', email: 'required', phone: 'invalid', consent: 'required' },
    })
  })
})

describe('summarizeTickets', () => {
  it('counts confirmed places and arrivals per ticket type', () => {
    const rows = summarizeTickets(
      [{ id: 1, name: 'General', capacity: 10, onSale: true }],
      [
        { ticketType: 1, quantity: 3, status: 'confirmed', checkedInCount: 2 },
        { ticketType: 1, quantity: 4, status: 'cancelled', checkedInCount: 0 },
        { ticketType: 2, quantity: 5, status: 'confirmed', checkedInCount: 0 },
      ],
    )
    expect(rows).toEqual([
      { id: 1, name: 'General', capacity: 10, taken: 3, left: 7, registrations: 1, waiting: 0, arrived: 2, onSale: true },
    ])
  })
})
