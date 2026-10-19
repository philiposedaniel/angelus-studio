import { getPayload, type Payload } from 'payload'
import { SMTPServer } from 'smtp-server'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import type { Event, EventGuest, Tenant, User } from '@/payload-types'

import { ensureTenant } from '../helpers/seedTenant'

/** The hosts get an email for each reply, delivered over a real SMTP server started by the test. */

const PREFIX = 'int-notice-'
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
let hostA: User
let hostB: User
let counter = 0

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
      email: `${PREFIX}guest-${++counter}@example.com`,
      partySize: 2,
      language: 'en',
      rsvpStatus: 'pending',
      ...extra,
    } as never,
    overrideAccess: true,
  })

/** Answers as the guest does, from their invitation link. */
const reply = async (tenant: Tenant, invited: EventGuest, values: Record<string, string>) => {
  const { submitRsvp } = await import('@/lib/rsvp')
  const form = new FormData()
  form.set('token', invited.inviteToken!)
  for (const [key, value] of Object.entries(values)) form.set(key, value)
  return submitRsvp({ payload, tenantId: tenant.id, form })
}

const cleanup = async () => {
  await payload.delete({ collection: 'events', where: { slug: { like: PREFIX } }, overrideAccess: true })
  await payload.delete({ collection: 'users', where: { email: { like: PREFIX } } })
}

describe('reply notices to the hosts', () => {
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
    studioA = await ensureTenant(payload, { name: 'Int Notice Studio A', slug: 'int-notice-a' })
    studioB = await ensureTenant(payload, { name: 'Int Notice Studio B', slug: 'int-notice-b' })
    await cleanup()
    hostA = await makeUser('host-a', studioA, ['event-organizer'])
    hostB = await makeUser('host-b', studioB, ['event-organizer'])
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

  it('emails the hosts and the extra address each reply, with who is coming', async () => {
    const planner = `${PREFIX}planner@example.com`
    const event = await makeEvent(studioA, 'wedding', {
      organizers: [hostA.id],
      replyNoticeEmail: planner,
      mealOptions: [{ label: 'Fish' }, { label: 'Vegetarian' }],
    })
    const [fish, veg] = event.mealOptions!.map((option) => option.id!)
    const maria = await guest(event, 'Maria Silva')
    await deliver()
    expect(inbox).toHaveLength(0)

    await reply(studioA, maria, {
      response: 'attending',
      attendingCount: '2',
      'party.0.meal': fish!,
      'party.1.name': 'Pedro Silva',
      'party.1.meal': veg!,
      dietaryNotes: 'No nuts',
      guestMessage: 'Cannot wait!',
    })
    await deliver()
    expect(inbox).toHaveLength(1)
    expect(inbox[0]!.to.sort()).toEqual([hostA.email, planner].sort())
    const body = decoded(inbox[0]!.raw)
    expect(body).toContain(`Subject: Maria Silva replied: ${PREFIX}wedding`)
    expect(body).toContain('Attending, 2 people.')
    expect(body).toContain('Who is coming: Maria Silva (Fish), Pedro Silva (Vegetarian)')
    expect(body).toContain('Dietary needs: No nuts')
    expect(body).toContain('Their note: Cannot wait!')
    expect(body).toContain(`/en/portal/events/${event.id}`)
    // The guest's own link is not in it.
    expect(body).not.toContain(maria.inviteToken!)

    // The same reply is never announced twice, however often the job runs.
    await payload.jobs.queue({ task: 'send-email', input: { kind: 'replyNotice', id: maria.id } })
    await deliver()
    expect(inbox).toHaveLength(1)

    // A changed answer is a new notice.
    await new Promise((resolve) => setTimeout(resolve, 5))
    await reply(studioA, maria, { response: 'declined' })
    await deliver()
    expect(inbox).toHaveLength(2)
    expect(decoded(inbox[1]!.raw)).toContain('Not attending.')
  })

  it('stays quiet when turned off, for answers staff record, and with nobody to tell', async () => {
    const off = await makeEvent(studioA, 'off', { organizers: [hostA.id], replyNotices: false })
    await reply(studioA, await guest(off, 'Quiet Guest'), { response: 'declined' })

    const phoned = await makeEvent(studioA, 'phoned', { organizers: [hostA.id] })
    const byPhone = await guest(phoned, 'Phone Guest')
    await payload.update({ collection: 'event-guests', id: byPhone.id, data: { rsvpStatus: 'declined' }, overrideAccess: true })

    const nobody = await makeEvent(studioA, 'nobody')
    await reply(studioA, await guest(nobody, 'Lonely Guest'), { response: 'declined' })

    await deliver()
    expect(inbox).toHaveLength(0)
  })

  it("tells only the event's own hosts, never another studio's", async () => {
    const eventA = await makeEvent(studioA, 'studio-a', { organizers: [hostA.id] })
    await makeEvent(studioB, 'studio-b', { organizers: [hostB.id] })
    const ana = await guest(eventA, 'Ana Costa')
    // A reply through another studio's site is refused and announces nothing.
    expect(await reply(studioB, ana, { response: 'declined' })).toMatchObject({ status: 'error' })
    await deliver()
    expect(inbox).toHaveLength(0)

    await reply(studioA, ana, { response: 'declined' })
    await deliver()
    expect(mailTo(hostA.email)).toHaveLength(1)
    expect(mailTo(hostB.email)).toHaveLength(0)
    expect(decoded(inbox[0]!.raw)).toContain('From: Int Notice Studio A')
  })

  it('queues nothing while email is not set up', async () => {
    delete process.env.SMTP_HOST
    const event = await makeEvent(studioA, 'no-email', { organizers: [hostA.id] })
    const before = (await payload.count({ collection: 'payload-jobs' })).totalDocs
    await reply(studioA, await guest(event, 'No Mail'), { response: 'declined' })
    expect((await payload.count({ collection: 'payload-jobs' })).totalDocs).toBe(before)
  })
})
