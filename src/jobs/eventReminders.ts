import type { Payload, TaskConfig, Where } from 'payload'

import { emailConfigured } from '@/lib/email'
import { DAY_BEFORE_WINDOW_MS } from '@/lib/eventEmails'

import { deliverEventEmail } from './sendEmail'

/** Most reminders one run sends, so a large event is spread over a few runs. */
export const REMINDER_BATCH = 200

/**
 * Emails the day-before reminders that are due: guests who are coming and confirmed ticket
 * holders of published events starting within a day, for events that keep reminders on. Each
 * person gets one; a failed send is left for the next run.
 */
export async function sendDueReminders(payload: Payload, now = Date.now()) {
  const result = { sent: 0, failed: 0 }
  if (!emailConfigured()) return result
  const events = await payload.find({
    collection: 'events',
    where: {
      and: [
        { published: { equals: true } },
        { reminderEmails: { not_equals: false } },
        { startsAt: { greater_than: new Date(now).toISOString() } },
        { startsAt: { less_than_equal: new Date(now + DAY_BEFORE_WINDOW_MS).toISOString() } },
      ],
    },
    pagination: false,
    depth: 0,
    select: { title: true },
    overrideAccess: true,
  })
  const eventIds = events.docs.map((event) => event.id)
  if (eventIds.length === 0) return result

  const due: Where = { event: { in: eventIds } }
  const hasEmail: Where[] = [{ email: { exists: true } }, { email: { not_equals: '' } }, { dayBeforeSentAt: { exists: false } }]
  const guests = await payload.find({
    collection: 'event-guests',
    where: { and: [due, { rsvpStatus: { equals: 'attending' } }, ...hasEmail] },
    limit: REMINDER_BATCH,
    depth: 0,
    select: { name: true },
    overrideAccess: true,
  })
  const registrations = await payload.find({
    collection: 'registrations',
    where: { and: [due, { status: { equals: 'confirmed' } }, ...hasEmail] },
    limit: Math.max(0, REMINDER_BATCH - guests.docs.length),
    depth: 0,
    select: { name: true },
    overrideAccess: true,
  })
  const work = [
    ...guests.docs.map((guest) => ['guestDayBefore', guest.id] as const),
    ...registrations.docs.map((registration) => ['ticketDayBefore', registration.id] as const),
  ]
  for (const [kind, id] of work) {
    try {
      if (await deliverEventEmail(payload, kind, id)) result.sent += 1
    } catch (error) {
      result.failed += 1
      payload.logger.error({ err: error, msg: `Could not send a day-before reminder (${kind} ${id})` })
    }
  }
  return result
}

export const sendEventReminders: TaskConfig<{ input: object; output: { sent: number; failed: number } }> = {
  slug: 'send-event-reminders',
  label: 'Send day-before event reminders',
  schedule: [{ cron: '*/5 * * * *', queue: 'default' }],
  handler: async ({ req }) => ({ output: await sendDueReminders(req.payload) }),
}
