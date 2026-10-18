import type { PayloadHandler, PayloadRequest } from 'payload'

import { DEFAULT_LOCALE, isLocale } from '@/i18n/config'
import { emailConfigured, SEND_EMAIL_TASK } from '@/lib/email'
import { guestsToCsv, MAX_IMPORT_CHARS, planGuestImport } from '@/lib/guestCsv'
import { idOf } from '@/lib/ids'
import { tenantLocales } from '@/lib/locale'
import { siteOrigin } from '@/lib/siteOrigin'

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

  const existing = await req.payload
    .find({
      collection: 'event-guests',
      where: { event: { equals: event.id } },
      pagination: false,
      depth: 0,
      select: { email: true },
      req,
      user: req.user,
      overrideAccess: false,
    })
    .catch(() => null)
  if (!existing) return fail(403, 'Only studio admins and production managers can import guests.')

  const tenant = await req.payload
    .findByID({ collection: 'tenants', id: idOf(event.tenant)!, depth: 0 })
    .catch(() => null)
  const defaultLanguage = tenant && isLocale(tenant.defaultLocale) ? tenant.defaultLocale : DEFAULT_LOCALE
  const plan = planGuestImport(body.csv, {
    existingEmails: existing.docs.flatMap((guest) => (guest.email ? [guest.email] : [])),
    defaultLanguage,
  })
  if ('error' in plan) {
    const messages = {
      empty: 'The file has no guests. The first line must name the columns, e.g. Name, Email, Party size.',
      noNameColumn: 'The file needs a Name column.',
      tooLarge: 'The file is larger than 1 MB.',
      tooManyRows: 'A file can hold up to 2,000 guests. Split it and import each part.',
    }
    return fail(400, messages[plan.error])
  }

  const summary = {
    ready: plan.guests.length,
    duplicates: plan.duplicates,
    problems: plan.problems,
    preview: plan.guests.slice(0, 10).map(({ line: _line, ...guest }) => guest),
  }
  if (body.dryRun !== false) return Response.json({ ...summary, added: 0 })

  let added = 0
  for (const { line, ...guest } of plan.guests) {
    try {
      await req.payload.create({
        collection: 'event-guests',
        data: { ...guest, event: event.id, rsvpStatus: 'pending' },
        req,
        user: req.user,
        overrideAccess: false,
      })
      added += 1
    } catch (error) {
      req.payload.logger.warn({ err: error, msg: `Guest import: line ${line} was not added` })
      summary.problems.push({ line, message: 'This guest could not be added.' })
    }
  }
  return Response.json({ ...summary, added })
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
