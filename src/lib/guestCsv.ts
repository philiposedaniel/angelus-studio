import { isLocale, type Locale } from '@/i18n/config'
import { describeParty, MAX_PARTY_SIZE } from '@/lib/rsvp'
import type { EventGuest } from '@/payload-types'

/** Most rows one import may hold, and the largest file accepted (in characters). */
export const MAX_IMPORT_ROWS = 2000
export const MAX_IMPORT_CHARS = 1_000_000

/**
 * Reads CSV text: quoted fields, doubled quotes, line breaks inside quotes, CRLF and a leading
 * byte-order mark. The separator is a comma, or a semicolon when the header line uses those
 * (as spreadsheets set to many European languages save it).
 */
export function parseCsv(text: string): string[][] {
  const source = text.replace(/^﻿/, '')
  const firstLine = source.split(/\r?\n/, 1)[0] ?? ''
  const separator = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : ','
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < source.length; i++) {
    const char = source[i]!
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') {
        field += '"'
        i++
      } else if (char === '"') quoted = false
      else field += char
    } else if (char === '"' && field === '') quoted = true
    else if (char === separator) {
      row.push(field)
      field = ''
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && source[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else field += char
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  // Blank lines carry nothing.
  return rows.filter((r) => r.some((cell) => cell.trim() !== ''))
}

/** Column headers accepted on import, by the guest field they fill. Matching ignores case, spaces and punctuation. */
const HEADER_ALIASES: Record<ImportColumn, string[]> = {
  name: ['name', 'guest', 'guestname', 'fullname'],
  email: ['email', 'emailaddress', 'mail'],
  phone: ['phone', 'phonenumber', 'mobile', 'telephone'],
  group: ['group', 'side', 'category'],
  partySize: ['partysize', 'party', 'seats', 'guests', 'size'],
  language: ['language', 'lang', 'locale'],
}
type ImportColumn = 'name' | 'email' | 'phone' | 'group' | 'partySize' | 'language'

const normalizeHeader = (value: string) => value.toLowerCase().replace(/[^a-z]/g, '')

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export type ImportedGuest = {
  name: string
  email?: string
  phone?: string
  group?: string
  partySize: number
  language: Locale
}

export type ImportProblem = { line: number; message: string }

export type ImportPlan = {
  guests: (ImportedGuest & { line: number })[]
  problems: ImportProblem[]
  /** Rows left out because the guest is already on the list or earlier in the file. */
  duplicates: number
}

/**
 * Turns an uploaded guest list into guests to add. Rows with problems are reported by their
 * line in the file and left out; the rest can be added. A guest whose email address is already
 * on the event (or earlier in the file) is skipped, so importing the same file twice adds nobody.
 */
export function planGuestImport(
  text: string,
  { existingEmails, defaultLanguage }: { existingEmails: Iterable<string>; defaultLanguage: Locale },
): ImportPlan | { error: 'empty' | 'noNameColumn' | 'tooLarge' | 'tooManyRows' } {
  if (text.length > MAX_IMPORT_CHARS) return { error: 'tooLarge' }
  const rows = parseCsv(text)
  if (rows.length < 2) return { error: 'empty' }
  if (rows.length - 1 > MAX_IMPORT_ROWS) return { error: 'tooManyRows' }

  const columns = new Map<ImportColumn, number>()
  rows[0]!.forEach((header, index) => {
    const key = normalizeHeader(header)
    for (const [column, aliases] of Object.entries(HEADER_ALIASES) as [ImportColumn, string[]][]) {
      if (!columns.has(column) && aliases.includes(key)) columns.set(column, index)
    }
  })
  if (!columns.has('name')) return { error: 'noNameColumn' }

  const seen = new Set([...existingEmails].map((email) => email.toLowerCase()))
  const plan: ImportPlan = { guests: [], problems: [], duplicates: 0 }
  rows.slice(1).forEach((row, index) => {
    // Line numbers as a spreadsheet shows them: the header is line 1.
    const line = index + 2
    const cell = (column: ImportColumn) => {
      const at = columns.get(column)
      return at === undefined ? '' : (row[at] ?? '').trim()
    }
    const name = cell('name')
    const email = cell('email').toLowerCase()
    const phone = cell('phone')
    const group = cell('group')
    const seats = cell('partySize')
    const language = cell('language').toLowerCase()

    if (!name) return plan.problems.push({ line, message: 'The name is missing.' })
    if (name.length > 120) return plan.problems.push({ line, message: 'The name is longer than 120 characters.' })
    if (email && (email.length > 200 || !EMAIL.test(email))) {
      return plan.problems.push({ line, message: `"${email.slice(0, 60)}" is not an email address.` })
    }
    if (phone.length > 40) return plan.problems.push({ line, message: 'The phone number is too long.' })
    if (group.length > 80) return plan.problems.push({ line, message: 'The group is longer than 80 characters.' })
    const partySize = seats === '' ? 1 : /^\d+$/.test(seats) ? Number(seats) : NaN
    if (!Number.isInteger(partySize) || partySize < 1 || partySize > MAX_PARTY_SIZE) {
      return plan.problems.push({ line, message: `The party size must be a whole number from 1 to ${MAX_PARTY_SIZE}.` })
    }
    if (language && !isLocale(language)) {
      return plan.problems.push({ line, message: `"${language.slice(0, 20)}" is not a language code such as en or es.` })
    }
    if (email) {
      if (seen.has(email)) {
        plan.duplicates += 1
        return
      }
      seen.add(email)
    }
    plan.guests.push({
      line,
      name,
      email: email || undefined,
      phone: phone || undefined,
      group: group || undefined,
      partySize,
      language: isLocale(language) ? language : defaultLanguage,
    })
  })
  return plan
}

/** Spreadsheet apps run cells starting with these as formulas; a leading apostrophe keeps them text. */
const neutralize = (value: string) => (/^[=+\-@\t\r]/.test(value) ? `'${value}` : value)

export const csvCell = (value: unknown) => {
  const text = neutralize(value === null || value === undefined ? '' : String(value))
  return /[",\r\n;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

const RSVP_LABELS: Record<string, string> = {
  pending: 'Not answered',
  attending: 'Attending',
  declined: 'Not attending',
}

/** The guest list as CSV, with each guest's table, answer, check-in and invitation link. */
export function guestsToCsv(
  guests: readonly EventGuest[],
  invitationUrl: (guest: EventGuest) => string,
  tableName: (guest: EventGuest) => string = () => '',
  mealLabel: (id: string) => string | undefined = () => undefined,
) {
  const header = [
    'Name',
    'Email',
    'Phone',
    'Group',
    'Table',
    'Party size',
    'Language',
    'RSVP',
    'Attending',
    'Who is coming',
    'Dietary notes',
    'Message from the guest',
    'Responded at',
    'Checked in',
    'Checked in at',
    'Invitation link',
  ]
  const lines = guests.map((guest) =>
    [
      guest.name,
      guest.email,
      guest.phone,
      guest.group,
      tableName(guest),
      guest.partySize,
      guest.language,
      RSVP_LABELS[guest.rsvpStatus ?? 'pending'],
      guest.attendingCount ?? 0,
      guest.rsvpStatus === 'attending' ? describeParty(guest, mealLabel, (n) => `Guest ${n}`) : '',
      guest.dietaryNotes,
      guest.guestMessage,
      guest.respondedAt,
      guest.checkedInCount ?? 0,
      guest.checkedInAt,
      guest.inviteToken ? invitationUrl(guest) : '',
    ]
      .map(csvCell)
      .join(','),
  )
  return csvFile(header, lines)
}

/** A CSV file from its header and ready-made lines. */
export function csvFile(header: readonly string[], lines: readonly string[]) {
  // The byte-order mark makes Excel read the file as UTF-8, so accented names survive.
  return `﻿${[header.join(','), ...lines].join('\r\n')}\r\n`
}
