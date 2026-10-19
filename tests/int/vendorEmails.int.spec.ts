import { createLocalReq, getPayload, type Payload, type PayloadRequest } from 'payload'
import { SMTPServer } from 'smtp-server'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import type { Event, EventVendor, Tenant, User } from '@/payload-types'

import { ensureTenant } from '../helpers/seedTenant'

/** Vendors get their booking link by email, and the studio hears when they confirm. */

const PREFIX = 'int-vmail-'
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

const vendor = (tenant: Tenant, name: string, email: string | null = `${PREFIX}${++counter}@vendors.test`) =>
  payload.create({
    collection: 'vendors',
    data: { tenant: tenant.id, name: `${PREFIX}${name}`, category: 'music', contactName: 'Rui', email } as never,
    overrideAccess: true,
  })

const book = (event: Event, vendorId: number, extra: Record<string, unknown> = {}): Promise<EventVendor> =>
  payload.create({
    collection: 'event-vendors',
    data: {
      event: event.id,
      vendor: vendorId,
      role: 'DJ for the reception',
      status: 'booked',
      currency: 'eur',
      amountDue: 120000,
      arrivalAt: new Date(Date.now() + 29 * DAY).toISOString(),
      instructions: 'Use the side gate.',
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
  await payload.delete({ collection: 'vendors', where: { name: { like: PREFIX } }, overrideAccess: true })
  await payload.delete({ collection: 'users', where: { email: { like: PREFIX } } })
}

describe('vendor emails', () => {
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
    studioA = await ensureTenant(payload, { name: 'Int Vendor Mail Studio A', slug: 'int-vmail-a' })
    studioB = await ensureTenant(payload, { name: 'Int Vendor Mail Studio B', slug: 'int-vmail-b' })
    await cleanup()
    managerA = await makeUser('manager-a', studioA, ['production-manager'])
    managerB = await makeUser('manager-b', studioB, ['production-manager'])
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

  it('emails a vendor their link once they are booked, without the amounts', async () => {
    const event = await makeEvent(studioA, 'wedding', { location: 'Quinta da Regaleira, Sintra' })
    const dj = await vendor(studioA, 'Lisbon Sound')
    const proposed = await book(event, dj.id, { status: 'proposed' })
    await deliver()
    expect(inbox).toHaveLength(0)

    await payload.update({ collection: 'event-vendors', id: proposed.id, data: { status: 'booked' }, overrideAccess: true })
    await deliver()
    expect(mailTo(dj.email!)).toHaveLength(1)
    const body = decoded(inbox[0]!.raw)
    expect(body).toContain(`Subject: Your booking: ${PREFIX}wedding`)
    expect(body).toContain('Dear Rui,')
    expect(body).toContain(`Int Vendor Mail Studio A has booked you for ${PREFIX}wedding`)
    expect(body).toContain('as DJ for the reception.')
    expect(body).toContain('Please arrive at')
    expect(body).toContain('Where: Quinta da Regaleira, Sintra')
    expect(body).toContain(`/en/vendor/${proposed.vendorToken}`)
    expect(body).not.toContain('1200')
    expect(body).not.toContain('side gate')

    // Later changes, and confirming, send no second link.
    await payload.update({ collection: 'event-vendors', id: proposed.id, data: { instructions: 'Front gate.' }, overrideAccess: true })
    await deliver()
    expect(mailTo(dj.email!)).toHaveLength(1)

    // A vendor without an email address gets nothing, and nothing fails.
    const noEmail = await vendor(studioA, 'No Email', null)
    await book(event, noEmail.id)
    await deliver()
    expect(inbox).toHaveLength(1)
  })

  it("sends the link again on request, only for the booking's own studio", async () => {
    const { sendVendorLink } = await import('@/lib/vendors')
    const event = await makeEvent(studioA, 'resend')
    const dj = await vendor(studioA, 'Resend Sound')
    const booking = await book(event, dj.id)
    await deliver()
    expect(mailTo(dj.email!)).toHaveLength(1)

    expect((await sendVendorLink(await request(null, { booking: booking.id }))).status).toBe(401)
    expect((await sendVendorLink(await request(managerB, { booking: booking.id }))).status).toBe(404)
    // Within a minute of the last one, a second request sends nothing more.
    expect((await sendVendorLink(await request(managerA, { booking: booking.id }))).status).toBe(200)
    await deliver()
    expect(mailTo(dj.email!)).toHaveLength(1)

    const { runSql } = await import('@/lib/sqlSession')
    const { sql } = await import('@payloadcms/db-postgres')
    await runSql(payload, sql`UPDATE event_vendors SET booking_emailed_at = now() - interval '2 minutes' WHERE id = ${booking.id}`)
    expect((await sendVendorLink(await request(managerA, { booking: booking.id }))).status).toBe(200)
    await deliver()
    expect(mailTo(dj.email!)).toHaveLength(2)

    await payload.update({ collection: 'event-vendors', id: booking.id, data: { status: 'cancelled' }, overrideAccess: true })
    expect((await sendVendorLink(await request(managerA, { booking: booking.id }))).status).toBe(409)
  })

  it('tells the studio address when the vendor confirms from their link', async () => {
    const { confirmVendorBooking } = await import('@/lib/vendors')
    const studioAddress = `${PREFIX}events@studio.test`
    const event = await makeEvent(studioA, 'confirm', { replyNoticeEmail: studioAddress })
    const dj = await vendor(studioA, 'Confirm Sound')
    const booking = await book(event, dj.id)
    await deliver()
    inbox.length = 0

    const form = new FormData()
    form.set('token', booking.vendorToken!)
    form.set('vendorNote', 'We will bring our own lights.')
    // Through another studio's site, the link does nothing.
    expect(await confirmVendorBooking({ payload, tenantId: studioB.id, form })).toEqual({ status: 'error', reason: 'failed' })
    expect(await confirmVendorBooking({ payload, tenantId: studioA.id, form })).toEqual({ status: 'confirmed' })
    await deliver()
    expect(inbox).toHaveLength(1)
    expect(inbox[0]!.to).toEqual([studioAddress])
    const body = decoded(inbox[0]!.raw)
    expect(body).toContain(`Subject: ${PREFIX}Confirm Sound confirmed: ${PREFIX}confirm`)
    expect(body).toContain('Their note: We will bring our own lights.')
    expect(body).toContain(`/admin/collections/event-vendors/${booking.id}`)

    // Staff confirming by hand, or an event with no studio address, send nothing.
    const quiet = await makeEvent(studioA, 'quiet')
    const other = await book(quiet, dj.id)
    await deliver()
    inbox.length = 0
    const otherForm = new FormData()
    otherForm.set('token', other.vendorToken!)
    await confirmVendorBooking({ payload, tenantId: studioA.id, form: otherForm })
    const byHand = await book(event, dj.id, { role: 'Second set' })
    await deliver()
    inbox.length = 0
    await payload.update({ collection: 'event-vendors', id: byHand.id, data: { status: 'confirmed' }, user: managerA, overrideAccess: false })
    await deliver()
    expect(inbox).toHaveLength(0)
  })
})
