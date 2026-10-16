import { describe, expect, it } from 'vitest'

import { guestsToCsv, parseCsv, planGuestImport } from '@/lib/guestCsv'
import type { EventGuest } from '@/payload-types'

describe('parseCsv', () => {
  it('reads quotes, doubled quotes, line breaks in quotes, CRLF and a byte-order mark', () => {
    expect(parseCsv('﻿Name,Note\r\n"Silva, Maria","Said ""hi""\nthen left"\r\n\r\nJoão,ok\n')).toEqual([
      ['Name', 'Note'],
      ['Silva, Maria', 'Said "hi"\nthen left'],
      ['João', 'ok'],
    ])
  })

  it('reads files saved with semicolons', () => {
    expect(parseCsv('Name;Party size\nMaria;2')).toEqual([
      ['Name', 'Party size'],
      ['Maria', '2'],
    ])
  })
})

describe('planGuestImport', () => {
  const options = { existingEmails: ['taken@example.com'], defaultLanguage: 'en' as const }

  it('maps common column names and fills defaults', () => {
    const plan = planGuestImport('Full name,E-mail,Seats,Table,Lang\nMaria Silva,MARIA@example.com,2,Family,es\nRui,,,,', options)
    expect(plan).toEqual({
      duplicates: 0,
      problems: [],
      guests: [
        { line: 2, name: 'Maria Silva', email: 'maria@example.com', phone: undefined, group: 'Family', partySize: 2, language: 'es' },
        { line: 3, name: 'Rui', email: undefined, phone: undefined, group: undefined, partySize: 1, language: 'en' },
      ],
    })
  })

  it('reports problem rows by line and skips guests already on the list or repeated', () => {
    const plan = planGuestImport(
      'Name,Email,Party size,Language\n,a@example.com,1,en\nAna,not-an-email,1,en\nBea,,0,en\nCai,,2,xx\nDan,taken@example.com,1,en\nEva,eva@example.com,1,en\nEva again,EVA@example.com,1,en',
      options,
    )
    expect('error' in plan).toBe(false)
    if ('error' in plan) return
    expect(plan.problems.map((p) => p.line)).toEqual([2, 3, 4, 5])
    expect(plan.guests.map((g) => g.name)).toEqual(['Eva'])
    expect(plan.duplicates).toBe(2)
  })

  it('needs a header line with a Name column', () => {
    expect(planGuestImport('Name\n', options)).toEqual({ error: 'empty' })
    expect(planGuestImport('Email\nx@example.com', options)).toEqual({ error: 'noNameColumn' })
  })
})

describe('guestsToCsv', () => {
  it('writes every guest with their link, and keeps spreadsheet formulas from running', () => {
    const csv = guestsToCsv(
      [
        {
          id: 1,
          name: '=HYPERLINK("http://evil")',
          email: 'a@example.com',
          partySize: 2,
          language: 'en',
          rsvpStatus: 'attending',
          attendingCount: 2,
          dietaryNotes: 'Vegan, no nuts',
          inviteToken: 'T'.repeat(32),
          checkedInCount: 1,
        } as EventGuest,
      ],
      (guest) => `https://example.com/en/invite/${guest.inviteToken}`,
    )
    const [header, row] = csv.replace('﻿', '').trim().split('\r\n')
    expect(header).toMatch(/^Name,Email,Phone,Group,Party size/)
    expect(row).toContain(`"'=HYPERLINK(""http://evil"")"`)
    expect(row).toContain('"Vegan, no nuts"')
    expect(row).toContain('Attending')
    expect(row).toContain(`https://example.com/en/invite/${'T'.repeat(32)}`)
  })
})
