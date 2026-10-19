import { getPayload, type Payload } from 'payload'
import { SMTPServer } from 'smtp-server'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { issueFormToken, MIN_FILL_MS, submitInquiry } from '@/lib/inquiries'
import type { Tenant, User } from '@/payload-types'

import { ensureTenant } from '../helpers/seedTenant'

/** The studio gets an email for each website inquiry, and answers it by replying. */

const PREFIX = 'int-inqmail-'
const password = 'int-Password-1'
const FROM = 'studio@angelus.test'
const NOW = Date.now()

type Received = { to: string[]; raw: string }
const inbox: Received[] = []
let server: SMTPServer
const saved = { host: process.env.SMTP_HOST, port: process.env.SMTP_PORT, secure: process.env.SMTP_SECURE, from: process.env.EMAIL_FROM_ADDRESS }

let payload: Payload
let studioA: Tenant
let studioB: Tenant
let managerB: User
let counter = 0

const decoded = (raw: string) =>
  raw.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
const mailTo = (address: string) => inbox.filter((mail) => mail.to.includes(address))

const deliver = async () => {
  await payload.jobs.run()
  await new Promise((resolve) => setTimeout(resolve, 300))
}

const setContact = async (tenant: Tenant, contact: { email?: string | null; inquiryAlerts?: boolean }) => {
  const settings = (await payload.find({ collection: 'site-settings', where: { tenant: { equals: tenant.id } }, limit: 1, overrideAccess: true })).docs[0]!
  await payload.update({ collection: 'site-settings', id: settings.id, data: { contact: { ...settings.contact, ...contact } }, overrideAccess: true })
}

/** A filled-in form as a person would send it, a few seconds after the page loaded. */
const send = (tenant: Tenant, overrides: Record<string, string> = {}, locale = 'en') => {
  const form = new FormData()
  const values: Record<string, string> = {
    formToken: issueFormToken(tenant.id, NOW - MIN_FILL_MS - 1000),
    name: 'Maria Silva',
    email: `${PREFIX}visitor${++counter}@example.com`,
    phone: '+351 912 345 678',
    eventType: 'wedding',
    eventDate: '2027-07-10',
    location: 'Sintra',
    message: 'We are getting married next summer and would love a film.',
    consent: 'on',
    ...overrides,
  }
  for (const [key, value] of Object.entries(values)) form.set(key, value)
  return submitInquiry({ payload, tenantId: tenant.id, locale, form, address: `198.51.100.${counter}`, now: NOW })
}

const latest = async () =>
  (await payload.find({ collection: 'inquiries', where: { email: { like: PREFIX } }, sort: '-createdAt', limit: 1, overrideAccess: true })).docs[0]!

const cleanup = async () => {
  await payload.delete({ collection: 'inquiries', where: { email: { like: PREFIX } }, overrideAccess: true })
  await payload.delete({ collection: 'users', where: { email: { like: PREFIX } } })
}

describe('inquiry alerts', () => {
  beforeAll(async () => {
    server = new SMTPServer({
      authOptional: true,
      disabledCommands: ['STARTTLS', 'AUTH'],
      logger: false,
      onData(stream, session, callback) {
        let raw = ''
        stream.on('data', (chunk: Buffer) => (raw += chunk.toString('utf8')))
        stream.on('end', () => {
          inbox.push({ to: session.envelope.rcptTo.map((rcpt) => rcpt.address), raw })
          callback()
        })
      },
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.server.address()
    process.env.SMTP_HOST = '127.0.0.1'
    process.env.SMTP_PORT = String(typeof address === 'object' && address ? address.port : 0)
    process.env.SMTP_SECURE = 'false'
    process.env.EMAIL_FROM_ADDRESS = FROM

    const { default: config } = await import('@/payload.config')
    payload = await getPayload({ config: await config })
    studioA = await ensureTenant(payload, { name: 'Int Inquiry Mail Studio A', slug: 'int-inqmail-a' })
    studioB = await ensureTenant(payload, { name: 'Int Inquiry Mail Studio B', slug: 'int-inqmail-b' })
    await cleanup()
    const created = await payload.create({
      collection: 'users',
      data: { email: `${PREFIX}manager-b@angelus.test`, password, roles: ['user'], tenants: [{ tenant: studioB.id, roles: ['production-manager'] }] },
    })
    managerB = await payload.findByID({ collection: 'users', id: created.id, depth: 0 })
  }, 60_000)

  beforeEach(async () => {
    process.env.SMTP_HOST = '127.0.0.1'
    await setContact(studioA, { email: `${PREFIX}hello@studio-a.test`, inquiryAlerts: true })
    await setContact(studioB, { email: `${PREFIX}hello@studio-b.test`, inquiryAlerts: true })
    await payload.jobs.run()
    inbox.length = 0
  })

  afterAll(async () => {
    await cleanup()
    await setContact(studioA, { email: null })
    await setContact(studioB, { email: null })
    await new Promise<void>((resolve) => server.close(() => resolve()))
    for (const [key, value] of Object.entries({
      SMTP_HOST: saved.host,
      SMTP_PORT: saved.port,
      SMTP_SECURE: saved.secure,
      EMAIL_FROM_ADDRESS: saved.from,
    })) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })

  it("emails the studio's contact address once, with the request and the visitor as reply-to", async () => {
    expect(await send(studioA)).toEqual({ status: 'success' })
    await deliver()
    const inquiry = await latest()
    expect(mailTo(`${PREFIX}hello@studio-a.test`)).toHaveLength(1)
    const body = decoded(inbox[0]!.raw)
    expect(body).toContain('Subject: New inquiry from Maria Silva')
    expect(body).toMatch(new RegExp(`Reply-To: ${inquiry.email}`))
    expect(body).toContain('Production: Wedding')
    expect(body).toContain('Date: July 10, 2027')
    expect(body).toContain('Location: Sintra')
    expect(body).toContain(`Contact: ${inquiry.email}`)
    expect(body).toContain('+351 912 345 678')
    expect(body).toContain('We are getting married next summer')
    expect(body).toContain(`/admin/collections/inquiries/${inquiry.id}`)
    expect(body).not.toContain('Wrote in')
    expect(inquiry.alertSentAt).toBeTruthy()

    // Staff working on it later send nothing more.
    await payload.update({ collection: 'inquiries', id: inquiry.id, data: { status: 'contacted' }, overrideAccess: true })
    await deliver()
    expect(inbox).toHaveLength(1)
  })

  it('sends nothing for spam, or when the studio has no address or turned alerts off', async () => {
    await send(studioA, { website: 'http://spam.test' })
    await send(studioA, { message: 'http://a http://b http://c http://d' })
    await deliver()
    expect(inbox).toHaveLength(0)

    await setContact(studioA, { inquiryAlerts: false })
    await send(studioA)
    await setContact(studioA, { email: null, inquiryAlerts: true })
    await send(studioA)
    await deliver()
    expect(inbox).toHaveLength(0)
  })

  it("keeps each studio's inquiries to its own address and staff", async () => {
    await send(studioA, { name: 'Only For A' })
    await deliver()
    expect(mailTo(`${PREFIX}hello@studio-a.test`)).toHaveLength(1)
    expect(mailTo(`${PREFIX}hello@studio-b.test`)).toHaveLength(0)

    // Another studio's staff cannot see the inquiry, nor when it was emailed.
    const inquiry = await latest()
    const seen = await payload.find({ collection: 'inquiries', where: { id: { equals: inquiry.id } }, user: managerB, overrideAccess: false })
    expect(seen.docs).toHaveLength(0)
    await expect(
      payload.update({ collection: 'inquiries', id: inquiry.id, data: { alertSentAt: null }, user: managerB, overrideAccess: false }),
    ).rejects.toThrow()
  })

  it("writes in the studio's language and says which one the visitor used", async () => {
    await payload.update({ collection: 'tenants', id: studioB.id, data: { languages: ['es', 'en'], defaultLocale: 'es' } })
    try {
      await send(studioB, { name: 'John Smith', eventType: 'corporate' }, 'en')
      await deliver()
      const body = decoded(mailTo(`${PREFIX}hello@studio-b.test`)[0]!.raw)
      expect(body).toContain('Subject: Nueva solicitud de John Smith')
      expect(body).toContain('Escribi')
      expect(body).toContain('English')
    } finally {
      await payload.update({ collection: 'tenants', id: studioB.id, data: { languages: ['en'], defaultLocale: 'en' } })
    }
  })
})
