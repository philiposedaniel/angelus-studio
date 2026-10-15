import { beforeAll, describe, expect, it } from 'vitest'

import { checkFormToken, issueFormToken, looksLikeSpam, MIN_FILL_MS, validateInquiry } from '@/lib/inquiries'

const form = (values: Record<string, string>) => {
  const data = new FormData()
  for (const [key, value] of Object.entries(values)) data.set(key, value)
  return data
}

const valid = {
  name: 'Maria Silva',
  email: 'Maria@Example.com',
  eventType: 'wedding',
  eventDate: '2027-06-12',
  message: 'We are getting married in June.',
  consent: 'on',
}

describe('validateInquiry', () => {
  const today = new Date('2026-10-15T12:00:00Z')

  it('accepts a complete request and tidies it', () => {
    const result = validateInquiry(form(valid), today)
    expect(result).toMatchObject({ ok: true, input: { email: 'maria@example.com', eventType: 'wedding' } })
  })

  it('reports each missing or invalid field', () => {
    const result = validateInquiry(
      form({ email: 'nope', eventType: 'rocket-launch', eventDate: '2020-01-01', phone: 'call me' }),
      today,
    )
    expect(result).toEqual({
      ok: false,
      errors: {
        name: 'required',
        email: 'invalid',
        phone: 'invalid',
        eventType: 'required',
        eventDate: 'invalid',
        message: 'required',
        consent: 'required',
      },
    })
  })

  it('refuses over-long messages', () => {
    const result = validateInquiry(form({ ...valid, message: 'x'.repeat(5001) }), today)
    expect(result).toMatchObject({ ok: false, errors: { message: 'tooLong' } })
  })
})

describe('form tokens', () => {
  beforeAll(() => {
    process.env.PAYLOAD_SECRET ||= 'unit-test-secret'
  })

  it('accepts a token after a person-like delay, for the same studio only', () => {
    const issued = 1_000_000
    const token = issueFormToken(7, issued)
    expect(checkFormToken(token, 7, issued + MIN_FILL_MS + 1)).toBe('ok')
    expect(checkFormToken(token, 8, issued + MIN_FILL_MS + 1)).toBe('invalid')
    expect(checkFormToken(token, 7, issued + 500)).toBe('tooFast')
    expect(checkFormToken(token, 7, issued + 25 * 60 * 60 * 1000)).toBe('expired')
  })

  it('rejects tampered or missing tokens', () => {
    const token = issueFormToken(7, 1_000_000)
    expect(checkFormToken(token.replace(/^\d+/, '1'), 7, 2_000_000)).toBe('invalid')
    expect(checkFormToken('garbage', 7)).toBe('invalid')
    expect(checkFormToken(null, 7)).toBe('invalid')
  })
})

it('treats link-stuffed messages as spam', () => {
  expect(looksLikeSpam('See https://a https://b https://c https://d')).toBe(true)
  expect(looksLikeSpam('Our venue: https://quinta.example')).toBe(false)
})
