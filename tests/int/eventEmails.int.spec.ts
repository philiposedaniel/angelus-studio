import { createLocalReq, getPayload, type Payload, type PayloadRequest } from 'payload'
import { SMTPServer } from 'smtp-server'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import type { Event, Tenant, TicketType, User } from '@/payload-types'

import { ensureTenant } from '../helpers/seedTenant'

/**
 * Event emails go through a real SMTP server started by the test, so the whole path is
 * exercised: the hook or endpoint queues a job, the job writes the message and nodemailer
 * delivers it over SMTP.
 */

const PREFIX = 'int-email-'
const password = 'int-Password-1'
const DAY = 86_400_000
const FROM = 'events@angelus.test'

type Received = { to: string[]; raw: string }
const inbox: Received[] = []
let server: SMTPServer
const saved = { host: process.env.SMTP_HOST, port: process.env.SMTP_PORT, secure: process.env.SMTP_SECURE, from: process.env.EMAIL_FROM_ADDRESS }

let payload: Payload
let studioA: Tenant
let studioB: Tenant
let managerA: User
let managerB: User
let editorA: User
let event: Event
let counter = 0

/** The message body with quoted-printable soft breaks and escapes undone, enough to find links. */
const decoded = (raw: string) =>
  raw.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))

const mailTo = (address: string) => inbox.filter((mail) => mail.to.includes(address))

/** Runs the queued jobs, then waits for SMTP deliveries to land. */
const deliver = async () => {
  await payload.jobs.run()
  await new Promise((resolve) => setTimeout(resolve, 300))
}

const makeUser = async (name: string, tenant: Tenant, roles: string[]) => {
  const created = await payload.create({
    collection: 'users',
    data: {
      email: `${PREFIX}${name}@angelus.test`,
      password,
      roles: ['user'],
      tenants: [{ tenant: tenant.id, roles: roles as never }],
    },
  })
  return payload.findByID({ collection: 'users', id: created.id, depth: 0 })
}

const makeEvent = (slug: string, extra: Record<string, unknown> = {}) =>
  payload.create({
    collection: 'events',
    data: {
      tenant: studioA.id,
      title: `${PREFIX}${slug}`,
      slug: `${PREFIX}${slug}`,
      startsAt: new Date(Date.now() + 30 * DAY).toISOString(),
      timeZone: 'Europe/Lisbon',
      published: true,
      listed: true,
      ...extra,
    } as never,
    overrideAccess: true,
  })

const makeTicketType = (extra: Record<string, unknown> = {}): Promise<TicketType> =>
  payload.create({
    collection: 'ticket-types',
    data: { event: event.id, name: `${PREFIX}Seat`, capacity: 20, maxPerOrder: 4, price: 0, currency: 'eur', ...extra } as never,
    overrideAccess: true,
  })

const register = (ticketType: TicketType, extra: Record<string, unknown> = {}) =>
  payload.create({
    collection: 'registrations',
    data: {
      ticketType: ticketType.id,
      name: 'Rita Lopes',
      email: `${PREFIX}buyer${++counter}@example.com`,
      quantity: 2,
      language: 'en',
      ...extra,
    } as never,
    overrideAccess: true,
  })

const request = async (user: User | null, body: unknown) => {
  const req = (await createLocalReq({ user: user ?? undefined }, payload)) as PayloadRequest
  req.user = user ? ({ ...user, collection: 'users' } as PayloadRequest['user']) : null
  req.json = async () => body
  return req
}

const cleanup = async () => {
  await payload.delete({ collection: 'events', where: { slug: { like: PREFIX } }, overrideAccess: true })
  await payload.delete({ collection: 'users', where: { email: { like: PREFIX } } })
}

describe('event emails', () => {
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

    // Loaded after the variables are set, since the email adapter is chosen when the config loads.
    const { default: config } = await import('@/payload.config')
    payload = await getPayload({ config: await config })
    studioA = await ensureTenant(payload, { name: 'Int Email Studio A', slug: 'int-email-a', languages: ['en', 'es'] })
    studioB = await ensureTenant(payload, { name: 'Int Email Studio B', slug: 'int-email-b' })
    await cleanup()
    managerA = await makeUser('manager-a', studioA, ['production-manager'])
    managerB = await makeUser('manager-b', studioB, ['production-manager'])
    editorA = await makeUser('editor-a', studioA, ['editor'])
    event = await makeEvent('gala', { title: `${PREFIX}Summer gala` })
  }, 60_000)

  beforeEach(async () => {
    process.env.SMTP_HOST = '127.0.0.1'
    await payload.jobs.run()
    inbox.length = 0
  })

  afterAll(async () => {
    await cleanup()
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

  it('emails the ticket once when a registration is confirmed', async () => {
    const ticketType = await makeTicketType()
    const registration = await register(ticketType)
    await deliver()
    const mail = mailTo(registration.email)
    expect(mail).toHaveLength(1)
    const body = decoded(mail[0]!.raw)
    expect(body).toContain(`From: Int Email Studio A <${FROM}>`)
    expect(body).toContain(`Subject: Your ticket: ${PREFIX}Summer gala`)
    expect(body).toContain(`/en/tickets/${registration.ticketToken}`)
    expect(body).toContain('Your ticket admits 2 people.')

    const saved = await payload.findByID({ collection: 'registrations', id: registration.id, overrideAccess: true })
    expect(saved.confirmationSentAt).toBeTruthy()
    // A later change, or the job running twice, sends nothing more.
    await payload.update({ collection: 'registrations', id: registration.id, data: { staffNotes: 'VIP' }, overrideAccess: true })
    await payload.jobs.queue({ task: 'send-email', input: { kind: 'ticket', id: registration.id } })
    await deliver()
    expect(mailTo(registration.email)).toHaveLength(1)
  })

  it('waits for payment, and never emails a cancelled ticket', async () => {
    const ticketType = await makeTicketType()
    const pending = await register(ticketType, {
      status: 'pending',
      holdExpiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
    })
    await deliver()
    expect(mailTo(pending.email)).toHaveLength(0)
    await payload.update({ collection: 'registrations', id: pending.id, data: { status: 'confirmed' }, overrideAccess: true })
    await deliver()
    expect(mailTo(pending.email)).toHaveLength(1)

    // Cancelled before the job ran: the job checks again and sends nothing.
    const cancelled = await register(ticketType)
    await payload.update({ collection: 'registrations', id: cancelled.id, data: { status: 'cancelled' }, overrideAccess: true })
    await deliver()
    expect(mailTo(cancelled.email)).toHaveLength(0)
  })

  it('emails the next person on the waitlist when places are offered to them', async () => {
    const ticketType = await makeTicketType({ capacity: 1, maxPerOrder: 1 })
    const taken = await register(ticketType, { quantity: 1 })
    const entry = await payload.create({
      collection: 'waitlist-entries',
      data: { ticketType: ticketType.id, name: 'Nuno Reis', email: `${PREFIX}waiting@example.com`, quantity: 1, language: 'es' } as never,
      overrideAccess: true,
    })
    await deliver()
    expect(mailTo(entry.email)).toHaveLength(0)

    await payload.update({ collection: 'registrations', id: taken.id, data: { status: 'cancelled' }, overrideAccess: true })
    await deliver()
    const mail = mailTo(entry.email)
    expect(mail).toHaveLength(1)
    const body = decoded(mail[0]!.raw)
    // In the language they joined in.
    expect(body).toContain('Buenas noticias')
    expect(body).toContain(`/es/waitlist/${entry.claimToken}`)
  })

  it('sends invitations only for the people who manage the guest list, once each', async () => {
    const { sendInvitations } = await import('@/lib/guestListEndpoints')
    const guest = (name: string, email: string | null, language = 'en') =>
      payload.create({
        collection: 'event-guests',
        data: { event: event.id, name, email, partySize: 2, language, rsvpStatus: 'pending' } as never,
        overrideAccess: true,
      })
    const maria = await guest('Maria Silva', `${PREFIX}maria@example.com`)
    const ana = await guest('Ana Costa', `${PREFIX}ana@example.com`, 'es')
    await guest('No Email', null)

    for (const user of [managerB, editorA]) {
      expect([403, 404]).toContain((await sendInvitations(await request(user, { event: event.id }))).status)
    }
    expect((await sendInvitations(await request(null, { event: event.id }))).status).toBe(401)
    await deliver()
    expect(inbox).toHaveLength(0)

    const response = await sendInvitations(await request(managerA, { event: event.id }))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ queued: 2 })
    await deliver()
    expect(mailTo(maria.email!)).toHaveLength(1)
    expect(decoded(mailTo(maria.email!)[0]!.raw)).toContain(`/en/invite/${maria.inviteToken}`)
    // In the guest's own language.
    expect(decoded(mailTo(ana.email!)[0]!.raw)).toContain('Te invitamos a')
    expect(decoded(mailTo(ana.email!)[0]!.raw)).toContain(`/es/invite/${ana.inviteToken}`)
    expect(inbox).toHaveLength(2)

    // Pressing it again sends nothing new.
    expect(await (await sendInvitations(await request(managerA, { event: event.id }))).json()).toEqual({ queued: 0 })
    // Two runs of the same job never both send.
    await payload.update({ collection: 'event-guests', id: maria.id, data: { name: 'Maria Silva' }, overrideAccess: true })
    await payload.jobs.queue({ task: 'send-email', input: { kind: 'invitation', id: maria.id } })
    await deliver()
    expect(mailTo(maria.email!)).toHaveLength(1)

    // An unpublished event's links would not open, so it is refused.
    const draft = await makeEvent('draft', { published: false })
    expect((await sendInvitations(await request(managerA, { event: draft.id }))).status).toBe(409)
  })

  it('sends nothing and queues nothing while email is not set up', async () => {
    delete process.env.SMTP_HOST
    const { sendInvitations } = await import('@/lib/guestListEndpoints')
    const before = (await payload.count({ collection: 'payload-jobs' })).totalDocs
    const ticketType = await makeTicketType()
    await register(ticketType)
    expect((await payload.count({ collection: 'payload-jobs' })).totalDocs).toBe(before)
    expect((await sendInvitations(await request(managerA, { event: event.id }))).status).toBe(409)
  })
})
