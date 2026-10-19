import type { CalendarProject } from '@/lib/calendar'

/** Text values in an iCalendar file escape backslashes, commas, semicolons and line breaks (RFC 5545). */
export const escapeIcsText = (value: string) =>
  value.replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r\n|\r|\n/g, '\\n')

/** Lines are folded at 75 octets, never inside a character, with a space starting each continuation line. */
export const foldIcsLine = (line: string): string => {
  const encoder = new TextEncoder()
  const parts: string[] = []
  let current = ''
  let size = 0
  let limit = 75
  for (const character of line) {
    const bytes = encoder.encode(character).length
    if (size + bytes > limit) {
      parts.push(current)
      current = ''
      size = 0
      limit = 74 // continuation lines start with a space, which counts toward the 75 octets
    }
    current += character
    size += bytes
  }
  parts.push(current)
  return parts.join('\r\n ')
}

/** A UTC date-time in the form iCalendar uses, for example 20261019T130000Z. */
const utcStamp = (date: Date) => date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')

/** The shoot day as an iCalendar date (YYYYMMDD), counted in UTC like the rest of the platform. */
const dayValue = (isoDate: string) => isoDate.slice(0, 10).replace(/-/g, '')

/** The day after the shoot day, which ends an all-day event (the end date is exclusive). */
const nextDayValue = (isoDate: string) => {
  const next = new Date(`${isoDate.slice(0, 10)}T00:00:00.000Z`)
  next.setUTCDate(next.getUTCDate() + 1)
  return dayValue(next.toISOString())
}

/**
 * An iCalendar file with one all-day event per production. Only the fields in CalendarProject are
 * written, so notes, quotes and client details cannot leak into a calendar app.
 */
export function buildProductionCalendar(input: {
  productions: CalendarProject[]
  calendarName: string
  host: string
  now?: Date
}): string {
  const stamp = utcStamp(input.now ?? new Date())
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Angelus Studio//Productions//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeIcsText(input.calendarName)}`,
  ]
  for (const production of input.productions) {
    if (!production.shootDate) continue
    lines.push(
      'BEGIN:VEVENT',
      `UID:production-${production.id}@${input.host}`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${dayValue(production.shootDate)}`,
      `DTEND;VALUE=DATE:${nextDayValue(production.shootDate)}`,
      `SUMMARY:${escapeIcsText(production.title)}`,
    )
    if (production.location) lines.push(`LOCATION:${escapeIcsText(production.location)}`)
    lines.push(`STATUS:${production.status === 'planning' ? 'TENTATIVE' : 'CONFIRMED'}`, 'TRANSP:TRANSPARENT', 'END:VEVENT')
  }
  lines.push('END:VCALENDAR')
  return lines.map(foldIcsLine).join('\r\n') + '\r\n'
}
