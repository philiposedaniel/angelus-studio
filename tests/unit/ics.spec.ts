import { describe, expect, it } from 'vitest'

import { buildOccasionCalendar, buildProductionCalendar, escapeIcsText, foldIcsLine } from '@/lib/ics'

const now = new Date('2026-10-19T09:00:00.000Z')

describe('calendar file text', () => {
  it('escapes commas, semicolons, backslashes and line breaks', () => {
    expect(escapeIcsText('Hall A, floor 2; back\\door\nline two')).toBe(
      'Hall A\\, floor 2\\; back\\\\door\\nline two',
    )
  })

  it('folds long lines at 75 octets without splitting a character', () => {
    const folded = foldIcsLine('é'.repeat(60))
    const lines = folded.split('\r\n')
    expect(lines.length).toBeGreaterThan(1)
    for (const line of lines) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75)
    expect(lines.map((line, index) => (index === 0 ? line : line.slice(1))).join('')).toBe('é'.repeat(60))
  })
})

describe('production calendar file', () => {
  const productions = [
    { id: 7, title: 'Spring, gala', shootDate: '2026-11-14T00:00:00.000Z', location: 'Lisbon', status: 'confirmed' },
    { id: 8, title: 'Pitch', shootDate: '2026-11-30T00:00:00.000Z', location: null, status: 'planning' },
    { id: 9, title: 'Undated', shootDate: '', location: null, status: 'confirmed' },
  ]

  it('writes one all-day event per dated production, with an exclusive end day', () => {
    const body = buildProductionCalendar({ productions, calendarName: 'Studio A', host: 'a.test', now })
    expect(body.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true)
    expect(body.endsWith('END:VCALENDAR\r\n')).toBe(true)
    expect(body.split('BEGIN:VEVENT')).toHaveLength(3)
    expect(body).toContain('DTSTART;VALUE=DATE:20261114\r\nDTEND;VALUE=DATE:20261115')
    expect(body).toContain('DTSTART;VALUE=DATE:20261130\r\nDTEND;VALUE=DATE:20261201')
    expect(body).not.toContain('Undated')
  })

  it('gives each event a stable UID, escaped text and a status from the production stage', () => {
    const body = buildProductionCalendar({ productions, calendarName: 'Studio A', host: 'a.test', now })
    expect(body).toContain('UID:production-7@a.test')
    expect(body).toContain('SUMMARY:Spring\\, gala')
    expect(body).toContain('LOCATION:Lisbon')
    expect(body).toContain('STATUS:CONFIRMED')
    expect(body).toContain('STATUS:TENTATIVE')
    expect(body).toContain('DTSTAMP:20261019T090000Z')
  })
})

describe('buildOccasionCalendar', () => {
  const occasion = {
    uid: 'ticket-7',
    title: 'Summer Gala',
    startsAt: '2027-06-12T15:00:00.000Z',
    endsAt: '2027-06-12T23:00:00.000Z',
    location: 'Sintra; main hall',
    description: 'Your ticket: https://studio.test/en/tickets/abc',
    url: 'https://studio.test/en/tickets/abc',
  }

  it('writes one timed event in UTC with the link back', () => {
    const body = buildOccasionCalendar({ occasion, host: 'studio.test', now: new Date('2027-01-01T00:00:00Z') })
    expect(body.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true)
    expect(body.endsWith('END:VCALENDAR\r\n')).toBe(true)
    expect(body).toContain('UID:ticket-7@studio.test')
    expect(body).toContain('DTSTAMP:20270101T000000Z')
    expect(body).toContain('DTSTART:20270612T150000Z\r\nDTEND:20270612T230000Z')
    expect(body).toContain('LOCATION:Sintra\\; main hall')
    expect(body).toContain('URL:https://studio.test/en/tickets/abc')
    expect(body.match(/BEGIN:VEVENT/g)).toHaveLength(1)
  })

  it('leaves out a missing or backwards end time', () => {
    expect(buildOccasionCalendar({ occasion: { ...occasion, endsAt: null }, host: 'h' })).not.toContain('DTEND')
    expect(buildOccasionCalendar({ occasion: { ...occasion, endsAt: '2027-06-12T10:00:00.000Z' }, host: 'h' })).not.toContain('DTEND')
  })
})
