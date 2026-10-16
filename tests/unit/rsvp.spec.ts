import { describe, expect, it } from 'vitest'

import { rsvpIsOpen, summarizeRsvps, validateRsvp } from '@/lib/rsvp'

const form = (values: Record<string, string>) => {
  const data = new FormData()
  for (const [key, value] of Object.entries(values)) data.set(key, value)
  return data
}

describe('validateRsvp', () => {
  it('accepts a reply for up to the seats on the invitation', () => {
    expect(validateRsvp(form({ response: 'attending', attendingCount: '3' }), 3)).toMatchObject({
      ok: true,
      input: { response: 'attending', attendingCount: 3 },
    })
  })

  it('counts a guest alone when no number is sent', () => {
    expect(validateRsvp(form({ response: 'attending' }), 1)).toMatchObject({
      ok: true,
      input: { attendingCount: 1 },
    })
  })

  it('refuses more people than seats, zero, or a made-up number', () => {
    for (const attendingCount of ['4', '0', '-1', '1.5', 'two']) {
      expect(validateRsvp(form({ response: 'attending', attendingCount }), 3)).toEqual({
        ok: false,
        errors: { attendingCount: 'invalid' },
      })
    }
  })

  it('needs an answer and keeps notes within limits', () => {
    const result = validateRsvp(
      form({ response: 'maybe', dietaryNotes: 'x'.repeat(501), guestMessage: 'y'.repeat(1001) }),
      2,
    )
    expect(result).toEqual({
      ok: false,
      errors: { response: 'required', dietaryNotes: 'tooLong', guestMessage: 'tooLong' },
    })
  })

  it('gives a guest who declines no seats and no meal', () => {
    expect(
      validateRsvp(form({ response: 'declined', attendingCount: '2', dietaryNotes: 'vegan' }), 2),
    ).toMatchObject({ ok: true, input: { attendingCount: 0, dietaryNotes: '' } })
  })
})

describe('rsvpIsOpen', () => {
  const now = Date.parse('2026-11-01T12:00:00Z')
  it('is open until the deadline and while replies are on', () => {
    expect(rsvpIsOpen({ rsvpOpen: true, rsvpDeadline: null }, now)).toBe(true)
    expect(rsvpIsOpen({ rsvpOpen: true, rsvpDeadline: '2026-11-02T00:00:00Z' }, now)).toBe(true)
    expect(rsvpIsOpen({ rsvpOpen: true, rsvpDeadline: '2026-10-31T23:59:00Z' }, now)).toBe(false)
    expect(rsvpIsOpen({ rsvpOpen: false, rsvpDeadline: null }, now)).toBe(false)
  })
})

describe('summarizeRsvps', () => {
  it('counts invitations, seats and the people coming', () => {
    expect(
      summarizeRsvps([
        { rsvpStatus: 'attending', attendingCount: 2, partySize: 2 },
        { rsvpStatus: 'attending', attendingCount: 1, partySize: 3 },
        { rsvpStatus: 'declined', attendingCount: 0, partySize: 2 },
        { rsvpStatus: 'pending', attendingCount: 0, partySize: 1 },
      ]),
    ).toEqual({ invitations: 4, seats: 8, attending: 2, declined: 1, pending: 1, headcount: 3 })
  })
})
