import type { Payload } from 'payload'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { emailAdapter, emailMode, fromStudio, LOG_FROM_ADDRESS, logEmailAdapter } from '@/lib/email'

const KEYS = ['EMAIL_MODE', 'SMTP_HOST', 'EMAIL_FROM_ADDRESS', 'EMAIL_FROM_NAME'] as const
const saved = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]))

afterEach(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key]
    else process.env[key] = saved[key]
  }
})

const env = (values: Partial<Record<(typeof KEYS)[number], string>>) => values as NodeJS.ProcessEnv

describe('emailMode', () => {
  it.each([
    ['nothing set', {}, 'off'],
    ['SMTP host without a sender address', { SMTP_HOST: 'smtp.example' }, 'off'],
    ['SMTP host and sender address', { SMTP_HOST: 'smtp.example', EMAIL_FROM_ADDRESS: 'hi@studio.example' }, 'smtp'],
    ['log mode with nothing else set', { EMAIL_MODE: 'log' }, 'log'],
    ['log mode even with SMTP set', { EMAIL_MODE: 'log', SMTP_HOST: 'smtp.example', EMAIL_FROM_ADDRESS: 'hi@studio.example' }, 'log'],
    ['off mode even with SMTP set', { EMAIL_MODE: 'off', SMTP_HOST: 'smtp.example', EMAIL_FROM_ADDRESS: 'hi@studio.example' }, 'off'],
    ['an unknown mode falls back to SMTP rules', { EMAIL_MODE: 'smtp', SMTP_HOST: 'smtp.example', EMAIL_FROM_ADDRESS: 'hi@studio.example' }, 'smtp'],
    ['an unknown mode without SMTP is off', { EMAIL_MODE: 'smtp' }, 'off'],
  ])('%s', (_, values, mode) => {
    expect(emailMode(env(values))).toBe(mode)
  })
})

describe('emailAdapter', () => {
  it('is none when email is off, so Payload does not try to send', () => {
    delete process.env.EMAIL_MODE
    delete process.env.SMTP_HOST
    expect(emailAdapter()).toBeUndefined()
  })

  it('is the log adapter in log mode', () => {
    process.env.EMAIL_MODE = 'log'
    expect(emailAdapter()).toBe(logEmailAdapter)
  })
})

describe('log adapter', () => {
  const build = (payload: unknown) => logEmailAdapter({ payload: payload as Payload })
  const logger = () => ({ info: vi.fn(), warn: vi.fn() })

  it('uses the platform sender when no sender address is set', () => {
    delete process.env.EMAIL_FROM_ADDRESS
    expect(build({ logger: logger() }).defaultFromAddress).toBe(LOG_FROM_ADDRESS)
  })

  it('warns once at startup that emails are written to the log, not sent', () => {
    const warn = vi.fn()
    build({ logger: { info: vi.fn(), warn } })
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('not sent (EMAIL_MODE=log)'))
  })

  it('writes the full message to the log and returns without sending', async () => {
    const info = vi.fn()
    const adapter = build({ logger: { info, warn: vi.fn() } })
    const message = { to: 'guest@example.test', from: 'Studio <hi@studio.example>', subject: 'Invitation', text: 'Open: https://studio.example/rsvp/abc' }

    await expect(adapter.sendEmail(message)).resolves.toEqual({ logged: true })

    expect(info).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'guest@example.test', subject: 'Invitation', text: 'Open: https://studio.example/rsvp/abc' }),
    )
  })

  it('logs a placeholder for an HTML-only message', async () => {
    const info = vi.fn()
    await build({ logger: { info, warn: vi.fn() } }).sendEmail({ to: 'a@studio.test', subject: 'Ticket', html: '<p>Ticket</p>' })
    expect(info).toHaveBeenCalledWith(expect.objectContaining({ text: '(HTML only)' }))
  })
})

describe('fromStudio', () => {
  it('uses the studio name with the sending address', () => {
    process.env.EMAIL_FROM_ADDRESS = 'hi@studio.example'
    expect(fromStudio('Angelus "Media"')).toBe('"Angelus Media" <hi@studio.example>')
  })

  it('falls back to the log sender in log mode', () => {
    delete process.env.EMAIL_FROM_ADDRESS
    expect(fromStudio('Angelus')).toBe(`"Angelus" <${LOG_FROM_ADDRESS}>`)
  })
})
