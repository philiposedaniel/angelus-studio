import { Forbidden, type Payload } from 'payload'

import type { Tenant, User } from '@/payload-types'

/** A calendar month as `YYYY-MM`. */
export const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/

export type CalendarMonth = { year: number; month: number; value: string }

/** The month asked for in the link, or the current UTC month when the link has none or a bad one. */
export const parseMonth = (value: unknown, now = new Date()): CalendarMonth => {
  const source = typeof value === 'string' && MONTH_PATTERN.test(value) ? value : null
  const year = source ? Number(source.slice(0, 4)) : now.getUTCFullYear()
  const month = source ? Number(source.slice(5, 7)) : now.getUTCMonth() + 1
  return { year, month, value: `${year}-${String(month).padStart(2, '0')}` }
}

/** The month before or after, for the previous and next links. */
export const shiftMonth = ({ year, month }: CalendarMonth, by: number): CalendarMonth => {
  const index = year * 12 + (month - 1) + by
  const nextYear = Math.floor(index / 12)
  const nextMonth = (index % 12) + 1
  return {
    year: nextYear,
    month: nextMonth,
    value: `${nextYear}-${String(nextMonth).padStart(2, '0')}`,
  }
}

/** First day of the month and first day of the next one, as UTC instants. The end is exclusive. */
export const monthBounds = ({ year, month }: CalendarMonth) => ({
  start: new Date(Date.UTC(year, month - 1, 1)).toISOString(),
  end: new Date(Date.UTC(year, month, 1)).toISOString(),
})

export type CalendarProject = {
  id: number
  title: string
  shootDate: string
  location?: string | null
  status: string
}

/**
 * The productions of one studio with a shoot day in the month, as the given user may see them.
 * Only the calendar fields are selected, so internal notes, quotes and client details never reach
 * the page. The access rules decide which projects the user can see; this does not widen them.
 */
export async function productionsInMonth(
  payload: Payload,
  user: User,
  tenant: Tenant,
  month: CalendarMonth,
): Promise<CalendarProject[]> {
  const { start, end } = monthBounds(month)
  const found = await payload
    .find({
      collection: 'projects',
      user,
      overrideAccess: false,
      where: {
        and: [
          { tenant: { equals: tenant.id } },
          { shootDate: { greater_than_equal: start } },
          { shootDate: { less_than: end } },
        ],
      },
      sort: 'shootDate',
      select: { title: true, shootDate: true, location: true, status: true },
      depth: 0,
      limit: 200,
    })
    .catch((error: unknown) => {
      // People who may not see productions at all (such as clients) get an empty calendar, not an error.
      if (error instanceof Forbidden) return null
      throw error
    })
  if (!found) return []
  return found.docs.map((doc) => ({
    id: doc.id,
    title: doc.title,
    shootDate: doc.shootDate ?? '',
    location: doc.location,
    status: doc.status,
  }))
}
