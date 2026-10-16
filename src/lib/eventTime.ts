type Timed = { startsAt: string; endsAt?: string | null; timeZone?: string | null }

/** When an event happens, in the event's own time zone, e.g. "Saturday, 14 November 2026, 18:00–23:30". */
export function formatEventWhen(event: Timed, locale: string) {
  const zone = event.timeZone || 'Europe/Lisbon'
  const day = new Intl.DateTimeFormat(locale, { dateStyle: 'full', timeZone: zone })
  const time = new Intl.DateTimeFormat(locale, { timeStyle: 'short', timeZone: zone })
  const start = new Date(event.startsAt)
  const end = event.endsAt ? new Date(event.endsAt) : null
  const hours = end ? `${time.format(start)}–${time.format(end)}` : time.format(start)
  return `${day.format(start)}, ${hours}`
}
