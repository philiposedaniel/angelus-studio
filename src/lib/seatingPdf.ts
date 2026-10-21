import type { PayloadHandler } from 'payload'
import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from 'pdf-lib'

import { getDictionary } from '@/i18n/dictionaries'
import { idOf } from '@/lib/ids'
import { pdfSafeText, wrapText } from '@/lib/invoicePdf'
import { tenantLocales } from '@/lib/locale'
import { isGuestListStaff, isOrganizerOf } from '@/lib/organizers'
import { seatsNeeded, summarizeSeating } from '@/lib/seating'
import type { EventGuest, EventTable } from '@/payload-types'

/** Words the PDF prints, from the interface dictionary so the plan follows the studio's language. */
export type SeatingPdfLabels = {
  title: string
  seats: string
  overCapacity: string
  meals: string
  dietary: string
  notAnswered: string
  withoutTable: string
  noTables: string
}

type PlanGuest = Pick<EventGuest, 'id' | 'name' | 'table' | 'rsvpStatus' | 'attendingCount' | 'partySize' | 'party' | 'dietaryNotes'>

export type SeatingPdfInput = {
  eventTitle: string
  when: string
  tables: readonly Pick<EventTable, 'id' | 'name' | 'capacity'>[]
  guests: readonly PlanGuest[]
  /** The label of each of the event's meal choices, by its id. */
  mealLabel: (mealId: string) => string | undefined
}

const PAGE_WIDTH = 595.28 // A4
const PAGE_HEIGHT = 841.89
const MARGIN = 48
const TEXT_WIDTH = PAGE_WIDTH - 2 * MARGIN
const INK = rgb(0.1, 0.1, 0.1)
const MUTED = rgb(0.4, 0.4, 0.4)
const WARN = rgb(0.7, 0.15, 0.1)

const fill = (template: string, values: Record<string, string | number>) =>
  Object.entries(values).reduce((text, [key, value]) => text.replaceAll(`{${key}}`, String(value)), template)

/** The people coming in a guest's party, each with their meal, or just the guest while they have not answered. */
function guestLines(guest: PlanGuest, input: SeatingPdfInput, labels: SeatingPdfLabels) {
  const seats = seatsNeeded(guest)
  const people = (guest.party ?? []).filter((person) => person.name || person.meal)
  const named = people.map((person) => {
    const meal = person.meal ? input.mealLabel(person.meal) : undefined
    return meal ? `${person.name || '?'} (${meal})` : person.name || '?'
  })
  const answer = guest.rsvpStatus === 'attending' ? '' : ` · ${labels.notAnswered}`
  const lines = [`${guest.name} · ${seats}${answer}`]
  if (named.length > 0) lines.push(named.join(', '))
  if (guest.dietaryNotes) lines.push(`${labels.dietary}: ${guest.dietaryNotes}`)
  return lines
}

/** How many of each meal the people at a table chose, in the order the event offers them. */
function mealCounts(guests: readonly PlanGuest[], input: SeatingPdfInput) {
  const counts = new Map<string, number>()
  for (const guest of guests) {
    if (guest.rsvpStatus !== 'attending') continue
    for (const person of guest.party ?? []) {
      const label = person.meal ? input.mealLabel(person.meal) : undefined
      if (label) counts.set(label, (counts.get(label) ?? 0) + 1)
    }
  }
  return [...counts].map(([label, count]) => `${label} ${count}`).join(', ')
}

/**
 * The seating plan as an A4 PDF to print for the venue and the caterer: each table with its seats
 * taken, the parties seated there with their names and meals, dietary needs, and a meal count per
 * table, then the guests still without a table. Guests who declined are left out. Staff notes,
 * contact details and invitation links are never printed.
 */
export async function renderSeatingPdf(input: SeatingPdfInput, labels: SeatingPdfLabels): Promise<Uint8Array> {
  const plan = summarizeSeating(input.tables, input.guests)
  const coming = (guests: readonly PlanGuest[]) => guests.filter((guest) => seatsNeeded(guest) > 0)
  const byId = new Map(input.guests.map((guest) => [String(guest.id), guest]))
  const full = (guests: readonly { id: PlanGuest['id'] }[]) => guests.map((guest) => byId.get(String(guest.id))!)

  const pdf = await PDFDocument.create()
  pdf.setTitle(pdfSafeText(`${labels.title}: ${input.eventTitle}`))
  const regular = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  let page: PDFPage = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT])
  let y = PAGE_HEIGHT - MARGIN

  const write = (value: string, size: number, font: PDFFont, color = INK, indent = 0) => {
    for (const line of wrapText(value, font, size, TEXT_WIDTH - indent)) {
      if (y - size < MARGIN) {
        page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT])
        y = PAGE_HEIGHT - MARGIN
      }
      page.drawText(line, { x: MARGIN + indent, y: y - size, size, font, color })
      y -= size + 4
    }
  }
  // Keeps a heading with at least the first lines below it.
  const keepTogether = (height: number) => {
    if (y - height >= MARGIN) return
    page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT])
    y = PAGE_HEIGHT - MARGIN
  }

  write(`${labels.title}: ${input.eventTitle}`, 18, bold)
  if (input.when) write(input.when, 11, regular, MUTED)
  y -= 10

  if (plan.tables.length === 0) write(labels.noTables, 11, regular, MUTED)
  for (const table of plan.tables) {
    keepTogether(60)
    write(table.name, 13, bold)
    const seats = fill(labels.seats, { taken: table.seats, capacity: table.capacity })
    write(table.over ? `${seats} · ${labels.overCapacity}` : seats, 10, regular, table.over ? WARN : MUTED)
    const guests = full(coming(table.guests))
    for (const guest of guests) {
      for (const [index, line] of guestLines(guest, input, labels).entries()) {
        write(line, 10, index === 0 ? bold : regular, index === 0 ? INK : MUTED, index === 0 ? 8 : 16)
      }
    }
    const meals = mealCounts(guests, input)
    if (meals) write(`${labels.meals}: ${meals}`, 10, regular, INK, 8)
    y -= 10
  }

  const unseated = full(plan.unseated)
  if (unseated.length > 0) {
    keepTogether(40)
    write(labels.withoutTable, 13, bold)
    for (const guest of unseated) {
      for (const [index, line] of guestLines(guest, input, labels).entries()) {
        write(line, 10, index === 0 ? bold : regular, index === 0 ? INK : MUTED, index === 0 ? 8 : 16)
      }
    }
  }
  return pdf.save()
}

const fail = (status: number, message: string) => Response.json({ errors: [{ message }] }, { status })

/**
 * GET /api/event-tables/plan?event=<id>: the event's seating plan as a PDF. The event, its tables
 * and its guests are read as the signed-in user, so the collections' own access rules decide who
 * gets it: the studio's admins and production managers, and the event's organizers.
 */
export const downloadSeatingPlan: PayloadHandler = async (req) => {
  if (!req.user) return fail(401, 'Sign in first.')
  const eventId = req.searchParams.get('event')
  if (!eventId || !/^\d+$/.test(eventId)) return fail(404, 'Event not found.')
  const access = { req, user: req.user, overrideAccess: false } as const
  const event = await req.payload.findByID({ collection: 'events', id: eventId, depth: 0, ...access }).catch(() => null)
  if (!event) return fail(404, 'Event not found.')
  // Anyone may read a published event, so say no before reading tables that would come back empty.
  if (!isGuestListStaff(req.user, idOf(event.tenant)) && !isOrganizerOf(req.user, event)) return fail(404, 'Event not found.')
  const tenant = await req.payload.findByID({ collection: 'tenants', id: idOf(event.tenant)!, depth: 0 }).catch(() => null)
  const locale = tenant ? tenantLocales(tenant)[0]! : 'en'
  const query = { where: { event: { equals: event.id } }, pagination: false, depth: 0, ...access } as const
  const [localized, tables, guests] = await Promise.all([
    req.payload.findByID({ collection: 'events', id: event.id, depth: 0, locale, ...access }).catch(() => event),
    req.payload.find({ collection: 'event-tables', ...query, sort: 'sortOrder' }).catch(() => null),
    req.payload
      .find({
        collection: 'event-guests',
        ...query,
        sort: 'name',
        select: { name: true, table: true, rsvpStatus: true, attendingCount: true, partySize: true, party: true, dietaryNotes: true },
      })
      .catch(() => null),
  ])
  if (!tables || !guests) return fail(403, 'Only the studio and the event\'s organizers can download the seating plan.')

  const t = getDictionary(locale).seatingPdf
  const when = new Intl.DateTimeFormat(locale, {
    dateStyle: 'full',
    timeStyle: 'short',
    timeZone: localized.timeZone || 'Europe/Lisbon',
  }).format(new Date(localized.startsAt))
  const bytes = await renderSeatingPdf(
    {
      eventTitle: localized.title,
      when: localized.location ? `${when} · ${localized.location}` : when,
      tables: tables.docs,
      guests: guests.docs,
      mealLabel: (mealId) => localized.mealOptions?.find((option) => option.id === mealId)?.label,
    },
    t,
  )
  const name = `seating-${event.slug || event.id}.pdf`.replace(/[^\w.-]/g, '_')
  return new Response(new Uint8Array(bytes), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${name}"`,
      'Content-Length': String(bytes.length),
      // Guests' names and dietary needs: keep it out of shared caches.
      'Cache-Control': 'private, no-store',
    },
  })
}
