import type { Payload } from 'payload'

/** Production statuses that hold a day. A planning production is not yet booked; a closed one has ended. */
export const BOOKED_PRODUCTION_STATUSES = ['confirmed', 'in-production', 'delivered'] as const

/** The day (YYYY-MM-DD) that a moment falls on in a time zone. */
export function dayIn(iso: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(iso))
  const part = (type: 'year' | 'month' | 'day') => parts.find((p) => p.type === type)?.value
  return `${part('year')}-${part('month')}-${part('day')}`
}

/**
 * The days in a window (start inclusive, end exclusive, as ISO instants) that the studio has booked: a
 * production on a booked status, or a published event. Only the days are returned, never titles, clients
 * or places, so the page can show the calendar to anyone who opens the studio's site.
 */
export async function busyDays(
  payload: Payload,
  tenantId: number,
  window: { start: string; end: string },
): Promise<string[]> {
  const [projects, events] = await Promise.all([
    payload.find({
      collection: 'projects',
      where: {
        and: [
          { tenant: { equals: tenantId } },
          { status: { in: [...BOOKED_PRODUCTION_STATUSES] } },
          { shootDate: { greater_than_equal: window.start } },
          { shootDate: { less_than: window.end } },
        ],
      },
      pagination: false,
      depth: 0,
      select: { shootDate: true },
      overrideAccess: true,
    }),
    payload.find({
      collection: 'events',
      where: {
        and: [
          { tenant: { equals: tenantId } },
          { published: { equals: true } },
          { startsAt: { greater_than_equal: window.start } },
          { startsAt: { less_than: window.end } },
        ],
      },
      pagination: false,
      depth: 0,
      select: { startsAt: true, timeZone: true },
      overrideAccess: true,
    }),
  ])

  const days = new Set<string>()
  // A shoot day is stored as a day, so its UTC date is the day.
  for (const project of projects.docs) if (project.shootDate) days.add(project.shootDate.slice(0, 10))
  for (const event of events.docs) days.add(dayIn(event.startsAt, event.timeZone || 'Europe/Lisbon'))
  return [...days].sort()
}
