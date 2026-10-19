import { createLocalReq, getPayload, type Payload, type PayloadRequest } from 'payload'
import { SMTPServer } from 'smtp-server'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import type { Event, EventGuest, Tenant, TicketType, User } from '@/payload-types'

import { ensureTenant } from '../helpers/seedTenant'

/**
 * Reply reminders and day-before reminders, delivered over a real SMTP server started by the
 * test, as in eventEmails.int.spec.ts.
 */

const PREFIX = 'int-remind-'
const password = 'int-Password-1'
const HOUR = 3_600_000
const DAY = 24 * HOUR
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
let counter = 0

/** A local mail server that keeps what it receives in `inbox`. */
const makeServer = () =>
  new SMTPServer({
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

const decoded = (raw: string) =>
  raw.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
const mailTo = (address: string) => inbox.filter((mail) => mail.to.includes(address))

const deliver = async () => {
  await payload.jobs.run()
  await new Promise((resolve) => setTimeout(resolve, 300))
}

const makeUser = async (name: string, tenant: Tenant, roles: string[]) => {
  const created = await payload.create({
    collection: 'users',
    data: { email: `${PREFIX}${name}@angelus.test`, password, roles: ['user'], tenants: [{ tenant: tenant.id, roles: roles as never }] },
  })
  return payload.findByID({ collection: 'users', id: created.id, depth: 0 })
}

const makeEvent = (tenant: Tenant, slug: string, extra: Record<string, unknown> = {}): Promise<Event> =>
  payload.create({
    collection: 'events',
    data: {
      tenant: tenant.id,
      title: `${PREFIX}${slug}`,
      slug: `${PREFIX}${slug}`,
      startsAt: new Date(Date.now() + 30 * DAY).toISOString(),
      timeZone: 'Europe/Lisbon',
      location: 'Quinta da Regaleira, Sintra',
      published: true,
      ...extra,
    } as never,
    overrideAccess: true,
  })

const guest = (event: Event, name: string, extra: Record<string, unknown> = {}): Promise<EventGuest> =>
  payload.create({
    collection: 'event-guests',
    data: {
      event: event.id,
      name,
      email: `${PREFIX}${name.toLowerCase().replace(/\W+/g, '-')}-${++counter}@example.com`,
      partySize: 2,
      language: 'en',
      rsvpStatus: 'pending',
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

describe('event reminders', () => {
  beforeAll(async () => {
    server = makeServer()
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.server.address()
    process.env.SMTP_HOST = '127.0.0.1'
    process.env.SMTP_PORT = String(typeof address === 'object' && address ? address.port : 0)
    process.env.SMTP_SECURE = 'false'
    process.env.EMAIL_FROM_ADDRESS = FROM

    const { default: config } = await import('@/payload.config')
    payload = await getPayload({ config: await config })
    studioA = await ensureTenant(payload, { name: 'Int Remind Studio A', slug: 'int-remind-a', languages: ['en', 'es'] })
    studioB = await ensureTenant(payload, { name: 'Int Remind Studio B', slug: 'int-remind-b' })
    await cleanup()
    managerA = await makeUser('manager-a', studioA, ['production-manager'])
    managerB = await makeUser('manager-b', studioB, ['production-manager'])
    editorA = await makeUser('editor-a', studioA, ['editor'])
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

  it('reminds only the guests who have not replied, and not again for a few days', async () => {
    const { sendReplyReminders } = await import('@/lib/guestListEndpoints')
    const deadline = new Date(Date.now() + 10 * DAY).toISOString()
    const event = await makeEvent(studioA, 'wedding', { rsvpDeadline: deadline })
    const pending = await guest(event, 'Maria Silva')
    const spanish = await guest(event, 'Ana Costa', { language: 'es' })
    const answered = await guest(event, 'Rui Dias', { rsvpStatus: 'declined' })
    await guest(event, 'No Email', { email: null })

    // Another studio, an editor and someone signed out are refused.
    for (const user of [managerB, editorA]) {
      expect([403, 404]).toContain((await sendReplyReminders(await request(user, { event: event.id }))).status)
    }
    expect((await sendReplyReminders(await request(null, { event: event.id }))).status).toBe(401)
    await deliver()
    expect(inbox).toHaveLength(0)

    const response = await sendReplyReminders(await request(managerA, { event: event.id }))
    expect(await response.json()).toEqual({ queued: 2 })
    await deliver()
    expect(mailTo(answered.email!)).toHaveLength(0)
    const mail = decoded(mailTo(pending.email!)[0]!.raw)
    expect(mail).toContain(`Subject: Will you be there? ${PREFIX}wedding`)
    expect(mail).toContain('We have not had your reply yet')
    expect(mail).toContain('Replies close on')
    expect(mail).toContain(`/en/invite/${pending.inviteToken}`)
    expect(decoded(mailTo(spanish.email!)[0]!.raw)).toContain('no tenemos tu respuesta')
    expect(inbox).toHaveLength(2)

    // Pressing again right away sends nothing; a guest who answers meanwhile gets nothing.
    expect(await (await sendReplyReminders(await request(managerA, { event: event.id }))).json()).toEqual({ queued: 0 })
    await payload.jobs.queue({ task: 'send-email', input: { kind: 'replyReminder', id: pending.id } })
    await deliver()
    expect(mailTo(pending.email!)).toHaveLength(1)

    // A few days later they can be reminded again, unless they have replied.
    const fourDaysAgo = new Date(Date.now() - 4 * DAY).toISOString()
    const { runSql } = await import('@/lib/sqlSession')
    const { sql } = await import('@payloadcms/db-postgres')
    await runSql(payload, sql`UPDATE event_guests SET reply_reminder_sent_at = ${fourDaysAgo}::timestamptz WHERE event_id = ${event.id}`)
    await payload.update({ collection: 'event-guests', id: spanish.id, data: { rsvpStatus: 'attending', attendingCount: 1 }, overrideAccess: true })
    expect(await (await sendReplyReminders(await request(managerA, { event: event.id }))).json()).toEqual({ queued: 1 })
    await deliver()
    expect(mailTo(pending.email!)).toHaveLength(2)
    expect(mailTo(spanish.email!)).toHaveLength(1)
  })

  it('sends no reply reminders once replies are closed', async () => {
    const { sendReplyReminders } = await import('@/lib/guestListEndpoints')
    const closed = await makeEvent(studioA, 'closed', { rsvpOpen: false })
    const late = await makeEvent(studioA, 'late', { rsvpDeadline: new Date(Date.now() - HOUR).toISOString() })
    const draft = await makeEvent(studioA, 'draft', { published: false })
    for (const event of [closed, late, draft]) {
      await guest(event, 'Waiting')
      expect((await sendReplyReminders(await request(managerA, { event: event.id }))).status).toBe(409)
    }
    // A reminder already queued when replies close is dropped by the job.
    const open = await makeEvent(studioA, 'closing')
    const waiting = await guest(open, 'Waiting')
    await payload.jobs.queue({ task: 'send-email', input: { kind: 'replyReminder', id: waiting.id } })
    await payload.update({ collection: 'events', id: open.id, data: { rsvpOpen: false }, overrideAccess: true })
    await deliver()
    expect(inbox).toHaveLength(0)
  })

  it('emails guests who are coming and ticket holders once, the day before', async () => {
    const { sendDueReminders } = await import('@/jobs/eventReminders')
    const soon = await makeEvent(studioA, 'tomorrow', { startsAt: new Date(Date.now() + 20 * HOUR).toISOString() })
    const later = await makeEvent(studioA, 'next-week', { startsAt: new Date(Date.now() + 7 * DAY).toISOString() })
    const quiet = await makeEvent(studioA, 'quiet', { startsAt: new Date(Date.now() + 20 * HOUR).toISOString(), reminderEmails: false })
    const other = await makeEvent(studioB, 'other', { startsAt: new Date(Date.now() + 20 * HOUR).toISOString() })

    const coming = await guest(soon, 'Coming', { rsvpStatus: 'attending', attendingCount: 2 })
    const notComing = await guest(soon, 'Not Coming', { rsvpStatus: 'declined' })
    const undecided = await guest(soon, 'Undecided')
    const nextWeek = await guest(later, 'Next Week', { rsvpStatus: 'attending', attendingCount: 1 })
    const optedOut = await guest(quiet, 'Quiet', { rsvpStatus: 'attending', attendingCount: 1 })
    const studioBGuest = await guest(other, 'Other Studio', { rsvpStatus: 'attending', attendingCount: 1 })

    const ticketType: TicketType = await payload.create({
      collection: 'ticket-types',
      data: { event: soon.id, name: `${PREFIX}Seat`, capacity: 20, maxPerOrder: 4, price: 0, currency: 'eur' } as never,
      overrideAccess: true,
    })
    const holder = await payload.create({
      collection: 'registrations',
      data: { ticketType: ticketType.id, name: 'Rita Lopes', email: `${PREFIX}rita@example.com`, quantity: 2, language: 'en' } as never,
      overrideAccess: true,
    })
    const cancelled = await payload.create({
      collection: 'registrations',
      data: { ticketType: ticketType.id, name: 'Gone', email: `${PREFIX}gone@example.com`, quantity: 1, language: 'en' } as never,
      overrideAccess: true,
    })
    await payload.update({ collection: 'registrations', id: cancelled.id, data: { status: 'cancelled' }, overrideAccess: true })
    // Ticket confirmations go first, so only reminders are left to count.
    await deliver()
    inbox.length = 0

    const first = await sendDueReminders(payload)
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(first.failed).toBe(0)
    const guestMail = decoded(mailTo(coming.email!)[0]!.raw)
    expect(guestMail).toContain(`Subject: See you soon: ${PREFIX}tomorrow`)
    expect(guestMail).toContain('Where: Quinta da Regaleira, Sintra')
    expect(guestMail).toContain(`/en/invite/${coming.inviteToken}`)
    const ticketMail = decoded(mailTo(holder.email)[0]!.raw)
    expect(ticketMail).toContain(`/en/tickets/${holder.ticketToken}`)
    expect(ticketMail).toContain('Your ticket admits 2 people.')
    // Each studio's events get their own reminders, from their own studio.
    expect(decoded(mailTo(studioBGuest.email!)[0]!.raw)).toContain('From: Int Remind Studio B')
    for (const address of [notComing.email!, undecided.email!, nextWeek.email!, optedOut.email!, cancelled.email]) {
      expect(mailTo(address)).toHaveLength(0)
    }
    const sentSoFar = inbox.length

    // The next run sends nothing more.
    expect(await sendDueReminders(payload)).toEqual({ sent: 0, failed: 0 })
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(inbox).toHaveLength(sentSoFar)
    expect((await payload.findByID({ collection: 'event-guests', id: coming.id, overrideAccess: true })).dayBeforeSentAt).toBeTruthy()
  })

  it('leaves a reminder for the next run when the mail service fails', async () => {
    const { sendDueReminders } = await import('@/jobs/eventReminders')
    const soon = await makeEvent(studioA, 'retry', { startsAt: new Date(Date.now() + 2 * HOUR).toISOString() })
    const coming = await guest(soon, 'Retry Me', { rsvpStatus: 'attending', attendingCount: 1 })
    const port = process.env.SMTP_PORT
    // The mail server goes away for a moment, so the send fails.
    await new Promise<void>((resolve) => server.close(() => resolve()))
    const failed = await sendDueReminders(payload)
    expect(failed.failed).toBeGreaterThanOrEqual(1)
    expect((await payload.findByID({ collection: 'event-guests', id: coming.id, overrideAccess: true })).dayBeforeSentAt).toBeFalsy()
    server = makeServer()
    await new Promise<void>((resolve) => server.listen(Number(port), '127.0.0.1', resolve))
    const retried = await sendDueReminders(payload)
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(retried).toMatchObject({ failed: 0 })
    expect(retried.sent).toBeGreaterThanOrEqual(1)
    expect(mailTo(coming.email!)).toHaveLength(1)
  })

  it('sends no reminders while email is not set up', async () => {
    const { sendDueReminders } = await import('@/jobs/eventReminders')
    const { sendReplyReminders } = await import('@/lib/guestListEndpoints')
    const soon = await makeEvent(studioA, 'no-email', { startsAt: new Date(Date.now() + 2 * HOUR).toISOString() })
    await guest(soon, 'Nobody', { rsvpStatus: 'attending', attendingCount: 1 })
    delete process.env.SMTP_HOST
    expect(await sendDueReminders(payload)).toEqual({ sent: 0, failed: 0 })
    expect((await sendReplyReminders(await request(managerA, { event: soon.id }))).status).toBe(409)
  })
})
