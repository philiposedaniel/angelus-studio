import type { PayloadHandler } from 'payload'
import { PDFDocument, rgb, type PDFFont } from 'pdf-lib'

import { getDictionary } from '@/i18n/dictionaries'
import { idOf } from '@/lib/ids'
import { wrapText } from '@/lib/invoicePdf'
import { embedTextFonts, fontSafeText } from '@/lib/pdfFonts'
import { pdfResponse, readSeatingForPrint, type SeatingPdfInput } from '@/lib/seatingPdf'
import { seatsNeeded } from '@/lib/seating'

/** Words the cards print, from the interface dictionary so they follow the studio's language. */
export type PlaceCardLabels = {
  title: string
  guestOf: string
  noCards: string
}

export type PlaceCard = { name: string; table: string | null; meal: string | null }

/**
 * One card for each person coming, in the order of the guest's reply: the guest first, then each
 * person they named, and "Guest of …" for a person they left unnamed, each with the meal chosen for
 * them. Seats beyond the reply get "Guest of …" with no meal. Only guests who said they are coming
 * get cards, in table order and then by name; guests still without a table come last.
 */
export function placeCards(input: Pick<SeatingPdfInput, 'tables' | 'guests' | 'mealLabel'>, labels: PlaceCardLabels): PlaceCard[] {
  const tableOrder = new Map(input.tables.map((table, index) => [String(table.id), index]))
  const tableName = new Map(input.tables.map((table) => [String(table.id), table.name]))
  const coming = input.guests
    .filter((guest) => guest.rsvpStatus === 'attending' && seatsNeeded(guest) > 0)
    .map((guest) => ({ guest, order: tableOrder.get(String(idOf(guest.table))) ?? Number.MAX_SAFE_INTEGER }))
    .sort((a, b) => a.order - b.order || a.guest.name.localeCompare(b.guest.name))

  const cards: PlaceCard[] = []
  for (const { guest } of coming) {
    const table = tableName.get(String(idOf(guest.table))) ?? null
    const seats = seatsNeeded(guest)
    const guestOf = labels.guestOf.replace('{name}', guest.name)
    const party = guest.party ?? []
    for (let seat = 0; seat < seats; seat++) {
      // The first person in a reply is the guest themselves; the RSVP form does not ask their name.
      const person = party[seat]
      const name = person?.name?.trim() || (seat === 0 ? guest.name : guestOf)
      cards.push({ name, table, meal: person?.meal ? (input.mealLabel(person.meal) ?? null) : null })
    }
  }
  return cards
}

const PAGE_WIDTH = 595.28 // A4
const PAGE_HEIGHT = 841.89
const COLUMNS = 2
const ROWS = 5
const MARGIN = 36
const CARD_WIDTH = (PAGE_WIDTH - 2 * MARGIN) / COLUMNS
const CARD_HEIGHT = (PAGE_HEIGHT - 2 * MARGIN) / ROWS
const INK = rgb(0.1, 0.1, 0.1)
const MUTED = rgb(0.4, 0.4, 0.4)
const CUT = rgb(0.75, 0.75, 0.75)

/** The largest size up to `size` at which the text fits the width on one line. */
const fitSize = (text: string, font: PDFFont, size: number, width: number) => {
  let fitted = size
  while (fitted > 8 && font.widthOfTextAtSize(text, fitted) > width) fitted -= 1
  return fitted
}

/**
 * A name's size and lines on the card: one line, shrunk down to 12pt, then two lines down to 8pt,
 * then as many 8pt lines as it needs, so even the longest name stays inside the card.
 */
export const nameLayout = (text: string, font: PDFFont, width: number) => {
  for (let size = 20; size >= 12; size--) {
    if (font.widthOfTextAtSize(text, size) <= width) return { size, lines: [text] }
  }
  for (let size = 14; size >= 8; size--) {
    const lines = wrapText(text, font, size, width, (value) => fontSafeText(font, value))
    if (lines.length <= 2) return { size, lines }
  }
  return { size: 8, lines: wrapText(text, font, 8, width, (value) => fontSafeText(font, value)) }
}

/**
 * Place cards as an A4 PDF, ten to a page with light cut lines: each person's name, their table
 * and their meal, centred. Contact details, notes and invitation links are never printed.
 */
export async function renderPlaceCardsPdf(
  input: Pick<SeatingPdfInput, 'eventTitle' | 'tables' | 'guests' | 'mealLabel'>,
  labels: PlaceCardLabels,
): Promise<Uint8Array> {
  const cards = placeCards(input, labels)
  const pdf = await PDFDocument.create()
  pdf.setTitle(`${labels.title}: ${input.eventTitle}`.replace(/\s+/g, ' '))
  const { regular, bold } = await embedTextFonts(pdf)

  if (cards.length === 0) {
    const page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT])
    page.drawText(fontSafeText(bold, `${labels.title}: ${input.eventTitle}`), { x: MARGIN, y: PAGE_HEIGHT - MARGIN - 18, size: 18, font: bold, color: INK })
    page.drawText(fontSafeText(regular, labels.noCards), { x: MARGIN, y: PAGE_HEIGHT - MARGIN - 44, size: 11, font: regular, color: MUTED })
    return pdf.save()
  }

  const centred = (page: ReturnType<typeof pdf.addPage>, value: string, size: number, font: PDFFont, color: typeof INK, x: number, y: number) => {
    const text = fontSafeText(font, value)
    const fitted = fitSize(text, font, size, CARD_WIDTH - 24)
    page.drawText(text, { x: x + (CARD_WIDTH - font.widthOfTextAtSize(text, fitted)) / 2, y, size: fitted, font, color })
  }

  const perPage = COLUMNS * ROWS
  for (let start = 0; start < cards.length; start += perPage) {
    const page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT])
    cards.slice(start, start + perPage).forEach((card, index) => {
      const x = MARGIN + (index % COLUMNS) * CARD_WIDTH
      const top = PAGE_HEIGHT - MARGIN - Math.floor(index / COLUMNS) * CARD_HEIGHT
      page.drawRectangle({ x, y: top - CARD_HEIGHT, width: CARD_WIDTH, height: CARD_HEIGHT, borderColor: CUT, borderWidth: 0.5 })
      const middle = top - CARD_HEIGHT / 2
      const name = nameLayout(fontSafeText(bold, card.name), bold, CARD_WIDTH - 24)
      const lineHeight = name.size + 4
      let y = middle + 4 + ((name.lines.length - 1) * lineHeight) / 2
      for (const line of name.lines) {
        page.drawText(line, { x: x + (CARD_WIDTH - bold.widthOfTextAtSize(line, name.size)) / 2, y, size: name.size, font: bold, color: INK })
        y -= lineHeight
      }
      y += lineHeight - 22
      if (card.table) centred(page, card.table, 11, regular, MUTED, x, y)
      if (card.meal) centred(page, card.meal, 10, regular, MUTED, x, card.table ? y - 16 : y)
    })
  }
  return pdf.save()
}

/** GET /api/event-tables/place-cards?event=<id>: a place card for each person coming, as a PDF. */
export const downloadPlaceCards: PayloadHandler = async (req) => {
  const seating = await readSeatingForPrint(req)
  if (seating instanceof Response) return seating
  const bytes = await renderPlaceCardsPdf(seating, getDictionary(seating.locale).placeCardsPdf)
  return pdfResponse(bytes, `place-cards-${seating.event.slug || seating.event.id}.pdf`)
}
