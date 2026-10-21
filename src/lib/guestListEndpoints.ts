import type { Payload, PayloadHandler, PayloadRequest, Where } from 'payload'

import { DEFAULT_LOCALE, isLocale } from '@/i18n/config'
import { emailConfigured, SEND_EMAIL_TASK } from '@/lib/email'
import { REMIND_AGAIN_AFTER_DAYS } from '@/lib/eventEmails'
import { guestsToCsv, MAX_IMPORT_CHARS, planGuestImport, type ImportedGuest, type ImportProblem } from '@/lib/guestCsv'
import { idOf } from '@/lib/ids'
import { tenantLocales } from '@/lib/locale'
import { rsvpIsOpen } from '@/lib/rsvp'
import { siteOrigin } from '@/lib/siteOrigin'
import type { Event, User } from '@/payload-types'

const fail = (status: number, message: string) => Response.json({ errors: [{ message }] }, { status })

/**
 * The event, read as the signed-in user, so staff only reach their own studio's events.
 * Guest list rules (admins and production managers) are then applied by each guest query.
 */
async function eventFor(req: PayloadRequest, eventId: unknown) {
  if (typeof eventId !== 'string' && typeof eventId !== 'number') return null
  if (!/^\d+$/.test(String(eventId))) return null
  return req.payload
    .findByID({ collection: 'events', id: String(eventId), depth: 0, req, user: req.user, overrideAccess: false })
    .catch(() => null)
}

/** GET /api/event-guests/export?event=<id>: the event's guest list as a CSV file. */
export const exportGuestList: PayloadHandler = async (req) => {
  if (!req.user) return fail(401, 'Sign in first.')
  const event = await eventFor(req, req.searchParams.get('event'))
  if (!event) return fail(404, 'Event not found.')
  const guests = await req.payload
    .find({
      collection: 'event-guests',
      where: { event: { equals: event.id } },
      pagination: false,
      sort: 'name',
      depth: 0,
      req,
      user: req.user,
      overrideAccess: false,
    })
    .catch(() => null)
  if (!guests) return fail(403, 'Only studio admins and production managers can download the guest list.')

  const origin = await siteOrigin(req.payload, event.tenant)
  const tenant = await req.payload
    .findByID({ collection: 'tenants', id: idOf(event.tenant)!, depth: 0 })
    .catch(() => null)
  const offered = tenant ? tenantLocales(tenant) : [DEFAULT_LOCALE]
  const tables = await req.payload
    .find({
      collection: 'event-tables',
      where: { event: { equals: event.id } },
      pagination: false,
      depth: 0,
      select: { name: true },
      req,
      user: req.user,
      overrideAccess: false,
    })
    .catch(() => null)
  const tableNames = new Map((tables?.docs ?? []).map((table) => [String(table.id), table.name]))
  const csv = guestsToCsv(
    guests.docs,
    (guest) => {
      const language = guest.language && offered.includes(guest.language) ? guest.language : offered[0]
      return `${origin}/${language}/invite/${guest.inviteToken}`
    },
    (guest) => tableNames.get(String(idOf(guest.table))) ?? '',
    (mealId) => event.mealOptions?.find((option) => option.id === mealId)?.label,
  )
  const name = `guests-${event.slug || event.id}.csv`.replace(/[^\w.-]/g, '_')
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${name}"`,
      'Cache-Control': 'private, no-store',
    },
  })
}

export type GuestImportResult =
  | { error: 'forbidden' | 'empty' | 'noNameColumn' | 'tooLarge' | 'tooManyRows' }
  | {
      ready: number
      duplicates: number
      added: number
      problems: ImportProblem[]
      preview: Omit<ImportedGuest, 'language'>[]
    }

/**
 * Plans, or with `dryRun: false` adds, the guests in a CSV file for an event already read as the
 * user. The guest list is read and every guest created as the user, so the collection's own
 * access rules and checks decide: staff of the studio and the event's organizers.
 */
export async function importGuests({
  payload,
  user,
  event,
  csv,
  dryRun,
  req,
}: {
  payload: Payload
  user: User
  event: Pick<Event, 'id' | 'tenant'>
  csv: string
  dryRun: boolean
  req?: PayloadRequest
}): Promise<GuestImportResult> {
  const access = { user, overrideAccess: false, ...(req ? { req } : {}) } as const
  const existing = await payload
    .find({
      collection: 'event-guests',
      where: { event: { equals: event.id } },
      pagination: false,
      depth: 0,
      select: { email: true },
      ...access,
    })
    .catch(() => null)
  if (!existing) return { error: 'forbidden' }

  const tenant = await payload.findByID({ collection: 'tenants', id: idOf(event.tenant)!, depth: 0 }).catch(() => null)
  const defaultLanguage = tenant && isLocale(tenant.defaultLocale) ? tenant.defaultLocale : DEFAULT_LOCALE
  const plan = planGuestImport(csv, {
    existingEmails: existing.docs.flatMap((guest) => (guest.email ? [guest.email] : [])),
    defaultLanguage,
  })
  if ('error' in plan) return { error: plan.error }

  const summary = {
    ready: plan.guests.length,
    duplicates: plan.duplicates,
    problems: plan.problems,
    preview: plan.guests.slice(0, 10).map(({ line: _line, language: _language, ...guest }) => guest),
  }
  if (dryRun) return { ...summary, added: 0 }

  let added = 0
  for (const { line, ...guest } of plan.guests) {
    try {
      await payload.create({
        collection: 'event-guests',
        data: { ...guest, event: event.id, rsvpStatus: 'pending' },
        ...access,
      })
      added += 1
    } catch (error) {
      payload.logger.warn({ err: error, msg: `Guest import: line ${line} was not added` })
      summary.problems.push({ line, code: 'notAdded', message: 'This guest could not be added.' })
    }
  }
  return { ...summary, added }
}

/**
 * POST /api/event-guests/import with JSON `{ event, csv, dryRun }`. A dry run returns what would
 * be added and the rows with problems; otherwise the guests are created as the signed-in user,
 * so the collection's own access rules and checks apply to every one of them.
 */
export const importGuestList: PayloadHandler = async (req) => {
  if (!req.user) return fail(401, 'Sign in first.')
  const body = (await req.json?.().catch(() => null)) as
    | { event?: unknown; csv?: unknown; dryRun?: unknown }
    | null
    | undefined
  if (!body || typeof body.csv !== 'string') return fail(400, 'Send the guest list as CSV text.')
  if (body.csv.length > MAX_IMPORT_CHARS) return fail(413, 'The file is larger than 1 MB.')
  const event = await eventFor(req, body.event)
  if (!event) return fail(404, 'Event not found.')

  const result = await importGuests({
    payload: req.payload,
    user: req.user as User,
    event,
    csv: body.csv,
    dryRun: body.dryRun !== false,
    req,
  })
  if ('error' in result) {
    const messages = {
      forbidden: 'Only the studio and the event\'s organizers can import guests.',
      empty: 'The file has no guests. The first line must name the columns, e.g. Name, Email, Party size.',
      noNameColumn: 'The file needs a Name column.',
      tooLarge: 'The file is larger than 1 MB.',
      tooManyRows: 'A file can hold up to 2,000 guests. Split it and import each part.',
    }
    return fail(result.error === 'forbidden' ? 403 : 400, messages[result.error])
  }
  return Response.json(result)
}

/**
 * POST /api/event-guests/send-invitations with JSON `{ event }`: emails each guest who has an
 * email address and has not been emailed yet their personal invitation link. The guests are
 * read as the signed-in user, so only people who manage this guest list can send it, and each
 * email is sent once (see src/jobs/sendEmail.ts).
 */
export const sendInvitations: PayloadHandler = async (req) => {
  if (!req.user) return fail(401, 'Sign in first.')
  if (!emailConfigured()) return fail(409, 'Email sending is not set up yet.')
  const body = (await req.json?.().catch(() => null)) as { event?: unknown } | null | undefined
  const event = await eventFor(req, body?.event)
  if (!event) return fail(404, 'Event not found.')
  if (!event.published) return fail(409, 'Publish the event first: invitation links only open for published events.')
  const guests = await req.payload
    .find({
      collection: 'event-guests',
      where: {
        and: [{ event: { equals: event.id } }, { email: { exists: true } }, { email: { not_equals: '' } }, { invitationSentAt: { exists: false } }],
      },
      pagination: false,
      depth: 0,
      select: { name: true },
      req,
      user: req.user,
      overrideAccess: false,
    })
    .catch(() => null)
  if (!guests) return fail(403, 'Only the people who manage this guest list can send its invitations.')
  for (const guest of guests.docs) {
    await req.payload.jobs.queue({ task: SEND_EMAIL_TASK, input: { kind: 'invitation', id: guest.id }, req })
  }
  return Response.json({ queued: guests.docs.length })
}

/** The guests a reply reminder would go to now: not answered, with an email, not reminded lately. */
export const reminderWhere = (eventId: number | string, now = Date.now()): Where => ({
  and: [
    { event: { equals: eventId } },
    { rsvpStatus: { equals: 'pending' } },
    { email: { exists: true } },
    { email: { not_equals: '' } },
    {
      or: [
        { replyReminderSentAt: { exists: false } },
        { replyReminderSentAt: { less_than: new Date(now - REMIND_AGAIN_AFTER_DAYS * 86_400_000).toISOString() } },
      ],
    },
  ],
})

/**
 * POST /api/event-guests/send-reminders with JSON `{ event }`: emails a reminder to reply to
 * every guest who has not answered yet and has an email address, at most once every few days.
 */
export const sendReplyReminders: PayloadHandler = async (req) => {
  if (!req.user) return fail(401, 'Sign in first.')
  if (!emailConfigured()) return fail(409, 'Email sending is not set up yet.')
  const body = (await req.json?.().catch(() => null)) as { event?: unknown } | null | undefined
  const event = await eventFor(req, body?.event)
  if (!event) return fail(404, 'Event not found.')
  if (!event.published) return fail(409, 'Publish the event first: invitation links only open for published events.')
  if (!rsvpIsOpen(event)) return fail(409, 'Replies are closed for this event.')
  const guests = await req.payload
    .find({
      collection: 'event-guests',
      where: reminderWhere(event.id),
      pagination: false,
      depth: 0,
      select: { name: true },
      req,
      user: req.user,
      overrideAccess: false,
    })
    .catch(() => null)
  if (!guests) return fail(403, 'Only the people who manage this guest list can send its reminders.')
  for (const guest of guests.docs) {
    await req.payload.jobs.queue({ task: SEND_EMAIL_TASK, input: { kind: 'replyReminder', id: guest.id }, req })
  }
  return Response.json({ queued: guests.docs.length })
}
