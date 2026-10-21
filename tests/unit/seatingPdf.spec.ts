import { inflateSync } from 'node:zlib'

import { PDFDocument } from 'pdf-lib'
import { describe, expect, it } from 'vitest'

import { renderSeatingPdf, type SeatingPdfLabels } from '@/lib/seatingPdf'

const labels: SeatingPdfLabels = {
  title: 'Seating plan',
  seats: '{taken} of {capacity} seats',
  overCapacity: 'over capacity',
  meals: 'Meals',
  dietary: 'Dietary needs',
  notAnswered: 'not answered yet',
  withoutTable: 'Without a table',
  noTables: 'No tables yet.',
}

/** The text drawn on the PDF's pages, line by line. */
const drawnText = (bytes: Uint8Array) =>
  [...Buffer.from(bytes).toString('latin1').matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)]
    .map((match) => {
      try {
        return inflateSync(Buffer.from(match[1]!, 'latin1')).toString('latin1')
      } catch {
        return ''
      }
    })
    .flatMap((content) => [...content.matchAll(/<([0-9A-F]*)> Tj/g)].map((hex) => Buffer.from(hex[1]!, 'hex').toString('latin1')))
    .join('\n')

const meals: Record<string, string> = { fish: 'Fish', meat: 'Meat' }

describe('renderSeatingPdf', () => {
  it('prints each table with its parties, meals and dietary needs, and who has no table', async () => {
    const bytes = await renderSeatingPdf(
      {
        eventTitle: 'Ana and João',
        when: 'Saturday, June 12, 2027 · Sintra',
        tables: [
          { id: 1, name: 'Table 1', capacity: 4 },
          { id: 2, name: 'Family', capacity: 2 },
        ],
        guests: [
          {
            id: 10,
            name: 'Maria Silva',
            table: 1,
            rsvpStatus: 'attending',
            attendingCount: 2,
            partySize: 2,
            party: [
              { name: 'Maria Silva', meal: 'fish' },
              { name: 'Rui Silva', meal: 'meat' },
            ],
            dietaryNotes: 'No nuts',
          },
          { id: 11, name: 'Declined Person', table: 1, rsvpStatus: 'declined', attendingCount: 0, partySize: 1 },
          { id: 12, name: 'Big Family', table: 2, rsvpStatus: 'pending', partySize: 3 },
          { id: 13, name: 'Late Guest', table: null, rsvpStatus: 'attending', attendingCount: 1, partySize: 1 },
        ],
        mealLabel: (id) => meals[id],
      },
      labels,
    )
    const text = drawnText(bytes)
    expect(text).toContain('Seating plan: Ana and Jo')
    expect(text).toContain('2 of 4 seats')
    expect(text).toContain('Maria Silva · 2')
    expect(text).toContain('Maria Silva (Fish), Rui Silva (Meat)')
    expect(text).toContain('Dietary needs: No nuts')
    expect(text).toContain('Meals: Fish 1, Meat 1')
    expect(text).toContain('3 of 2 seats · over capacity')
    expect(text).toContain('Big Family · 3 · not answered yet')
    expect(text).toContain('Without a table')
    expect(text).toContain('Late Guest · 1')
    expect(text).not.toContain('Declined Person')
  })

  it('says when there are no tables, and spreads a long plan over several pages', async () => {
    expect(drawnText(await renderSeatingPdf({ eventTitle: 'Gala', when: '', tables: [], guests: [], mealLabel: () => undefined }, labels))).toContain(
      'No tables yet.',
    )
    const tables = Array.from({ length: 20 }, (_, index) => ({ id: index + 1, name: `Table ${index + 1}`, capacity: 10 }))
    const guests = Array.from({ length: 200 }, (_, index) => ({
      id: 1000 + index,
      name: `Guest ${index}`,
      table: (index % 20) + 1,
      rsvpStatus: 'attending' as const,
      attendingCount: 1,
      partySize: 1,
    }))
    const bytes = await renderSeatingPdf({ eventTitle: 'Gala', when: '', tables, guests, mealLabel: () => undefined }, labels)
    expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThan(1)
    expect(drawnText(bytes)).toContain('Guest 199 · 1')
  })
})
