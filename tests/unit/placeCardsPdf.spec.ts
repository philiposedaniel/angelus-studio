import { inflateSync } from 'node:zlib'

import { PDFDocument } from 'pdf-lib'
import { describe, expect, it } from 'vitest'

import { placeCards, renderPlaceCardsPdf, type PlaceCardLabels } from '@/lib/placeCardsPdf'

const labels: PlaceCardLabels = { title: 'Place cards', guestOf: 'Guest of {name}', noCards: 'Nobody yet.' }
const meals: Record<string, string> = { fish: 'Fish', meat: 'Meat' }
const mealLabel = (id: string) => meals[id]

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

const tables = [
  { id: 2, name: 'Head table', capacity: 8 },
  { id: 1, name: 'Table 2', capacity: 8 },
]
const guests = [
  {
    id: 10,
    name: 'Ana Costa',
    table: 1,
    rsvpStatus: 'attending' as const,
    attendingCount: 3,
    partySize: 3,
    party: [
      { name: 'Ana Costa', meal: 'fish' },
      { name: 'Rui Costa', meal: 'meat' },
    ],
  },
  { id: 11, name: 'Bruno Dias', table: 2, rsvpStatus: 'attending' as const, attendingCount: 1, partySize: 2, party: [] },
  { id: 12, name: 'Carla Reis', table: 2, rsvpStatus: 'declined' as const, attendingCount: 0, partySize: 2, party: [] },
  { id: 13, name: 'Duarte Melo', table: 2, rsvpStatus: 'pending' as const, attendingCount: null, partySize: 2, party: [] },
  { id: 14, name: 'Eva Lima', table: null, rsvpStatus: 'attending' as const, attendingCount: 1, partySize: 1, party: [] },
]

describe('placeCards', () => {
  it('makes a card per person coming, in table order, with their table and meal', () => {
    expect(placeCards({ tables, guests, mealLabel }, labels)).toEqual([
      { name: 'Bruno Dias', table: 'Head table', meal: null },
      { name: 'Ana Costa', table: 'Table 2', meal: 'Fish' },
      { name: 'Rui Costa', table: 'Table 2', meal: 'Meat' },
      { name: 'Guest of Ana Costa', table: 'Table 2', meal: null },
      { name: 'Eva Lima', table: null, meal: null },
    ])
  })
})

describe('renderPlaceCardsPdf', () => {
  it('prints ten cards a page, and says so when nobody is coming yet', async () => {
    const many = Array.from({ length: 12 }, (_, n) => ({
      ...guests[1]!,
      id: 100 + n,
      name: `Guest ${String(n).padStart(2, '0')}`,
    }))
    const bytes = await renderPlaceCardsPdf({ eventTitle: 'Ana and João', tables, guests: many, mealLabel }, labels)
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(2)
    const text = drawnText(bytes)
    expect(text).toContain('Guest 00')
    expect(text).toContain('Guest 11')
    expect(text).toContain('Head table')

    const empty = await renderPlaceCardsPdf({ eventTitle: 'Ana and João', tables, guests: [guests[3]!], mealLabel }, labels)
    expect(drawnText(empty)).toContain('Nobody yet.')
  })
})
