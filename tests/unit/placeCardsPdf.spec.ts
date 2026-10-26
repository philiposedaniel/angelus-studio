import { PDFDocument } from 'pdf-lib'
import { describe, expect, it } from 'vitest'

import { nameLayout, placeCards, renderPlaceCardsPdf, type PlaceCardLabels } from '@/lib/placeCardsPdf'
import { embedTextFonts } from '@/lib/pdfFonts'

import { pdfText } from '../helpers/pdfText'

const labels: PlaceCardLabels = { title: 'Place cards', guestOf: 'Guest of {name}', noCards: 'Nobody yet.' }
const meals: Record<string, string> = { fish: 'Fish', meat: 'Meat' }
const mealLabel = (id: string) => meals[id]

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

  it('keeps the meal chosen for a person left unnamed, in the order of the reply', () => {
    const party = [
      { name: null, meal: 'fish' },
      { name: null, meal: 'meat' },
      { name: 'Rita', meal: 'fish' },
    ]
    const ines = { ...guests[0]!, name: 'Inês Santos', attendingCount: 4, partySize: 4, party }
    expect(placeCards({ tables, guests: [ines], mealLabel }, labels)).toEqual([
      { name: 'Inês Santos', table: 'Table 2', meal: 'Fish' },
      { name: 'Guest of Inês Santos', table: 'Table 2', meal: 'Meat' },
      { name: 'Rita', table: 'Table 2', meal: 'Fish' },
      { name: 'Guest of Inês Santos', table: 'Table 2', meal: null },
    ])
  })
})

describe('nameLayout', () => {
  it('keeps even the longest name inside the card', async () => {
    const pdf = await PDFDocument.create()
    const { bold } = await embedTextFonts(pdf)
    const width = 237
    expect(nameLayout('Ana Costa', bold, width)).toEqual({ size: 20, lines: ['Ana Costa'] })
    const longest = `Guest of ${'Bartholomew Fitzgerald-Montgomery '.repeat(4).slice(0, 120)}`
    const { size, lines } = nameLayout(longest, bold, width)
    expect(lines.length).toBeGreaterThan(1)
    for (const line of lines) expect(bold.widthOfTextAtSize(line, size)).toBeLessThanOrEqual(width)
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
    const text = await pdfText(bytes)
    expect(text).toContain('Guest 00')
    expect(text).toContain('Guest 11')
    expect(text).toContain('Head table')

    // Names print in their own letters; a script the font lacks becomes '?'.
    const accents = await renderPlaceCardsPdf(
      { eventTitle: 'Gala', tables, guests: [{ ...guests[4]!, name: 'Zoë Łukasz Ödön Şahin 王' }], mealLabel },
      labels,
    )
    expect(await pdfText(accents)).toContain('Zoë Łukasz Ödön Şahin ?')

    const empty = await renderPlaceCardsPdf({ eventTitle: 'Ana and João', tables, guests: [guests[3]!], mealLabel }, labels)
    expect(await pdfText(empty)).toContain('Nobody yet.')
  })
})
