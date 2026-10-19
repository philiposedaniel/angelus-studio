import { describe, expect, it } from 'vitest'

import { buildProductionCalendar, escapeIcsText, foldIcsLine } from '@/lib/ics'

const now = new Date('2026-10-19T09:00:00.000Z')

describe('calendar file text', () => {
  it('escapes commas, semicolons, backslashes and line breaks', () => {
    expect(escapeIcsText('Hall A, floor 2; back\\door\nline two')).toBe(
      'Hall A\\, floor 2\; back\\\\door\\nline two',
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
