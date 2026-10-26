import { getPayload, type Payload } from 'payload'
import { SMTPServer } from 'smtp-server'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Gallery, Tenant, User } from '@/payload-types'
import { deliverGalleryNotice } from '@/lib/galleryNotices'

import { ensureTenant } from '../helpers/seedTenant'

/**
 * Gallery emails go through a real SMTP server started by the test: publishing queues the job, the job
 * writes one message per client and nodemailer delivers it over SMTP.
 */

const PREFIX = 'int-gallery-notice-'
const password = 'int-Password-1'
const FROM = 'events@gallery-notice.test'

type Received = { to: string[]; raw: string }
const inbox: Received[] = []
let server: SMTPServer
const saved = { host: process.env.SMTP_HOST, port: process.env.SMTP_PORT, secure: process.env.SMTP_SECURE, from: process.env.EMAIL_FROM_ADDRESS }

let payload: Payload
let studio: Tenant
let other: Tenant
let clientOne: User
let clientTwo: User
let counter = 0

/** The message text with quoted-printable soft breaks and escapes undone, enough to find links. */
const decoded = (raw: string) =>
  raw.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))

/** Runs the queued jobs, then waits for SMTP deliveries to land. */
const deliver = async () => {
  await payload.jobs.run()
  await new Promise((resolve) => setTimeout(resolve, 300))
}

const makeUser = async (name: string, tenant: Tenant) => {
  const created = await payload.create({
    collection: 'users',
    data: {
      email: `${PREFIX}${name}@angelus.test`,
      password,
      roles: ['user'],
      tenants: [{ tenant: tenant.id, roles: ['client'] }],
    },
  })
  return payload.findByID({ collection: 'users', id: created.id, depth: 0 })
}

const makeGallery = (data: Partial<Gallery> = {}) => {
  counter += 1
  return payload.create({
    collection: 'galleries',
    data: {
      tenant: studio.id,
      title: `${PREFIX}gallery ${counter}`,
      slug: `${PREFIX}gallery-${counter}`,
      status: 'draft',
      clients: [clientOne.id, clientTwo.id],
      notifyClients: true,
      ...data,
    },
  })
}

const cleanup = async () => {
  await payload.delete({ collection: 'galleries', where: { slug: { like: PREFIX } }, overrideAccess: true })
  await payload.delete({ collection: 'users', where: { email: { like: PREFIX } } })
}

describe('gallery client emails', () => {
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
    studio = await ensureTenant(payload, { name: 'Int Gallery Notice Studio', slug: 'int-gallery-notice' })
    other = await ensureTenant(payload, { name: 'Int Gallery Notice Other', slug: 'int-gallery-notice-other' })
    await cleanup()
    clientOne = await makeUser('client-one', studio)
    clientTwo = await makeUser('client-two', studio)
  }, 60_000)

  beforeEach(async () => {
    vi.restoreAllMocks()
    process.env.SMTP_HOST = '127.0.0.1'
    await payload.jobs.run()
    inbox.length = 0
  })

  afterAll(async () => {
    vi.restoreAllMocks()
    await cleanup()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    for (const [key, value] of Object.entries({ SMTP_HOST: saved.host, SMTP_PORT: saved.port, SMTP_SECURE: saved.secure, EMAIL_FROM_ADDRESS: saved.from })) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })

  it('emails each client their own link once, when the gallery is published', async () => {
    const gallery = await makeGallery()
    await deliver()
    expect(inbox).toHaveLength(0)

    await payload.update({ collection: 'galleries', id: gallery.id, data: { status: 'published' } })
    await deliver()

    expect(inbox).toHaveLength(2)
    for (const client of [clientOne, clientTwo]) {
      const mails = inbox.filter((mail) => mail.to.includes(client.email))
      expect(mails).toHaveLength(1)
      // One address per message, so no client sees another's.
      expect(mails[0]!.to).toEqual([client.email])
      expect(decoded(mails[0]!.raw)).toContain(`/en/portal/galleries/${gallery.slug}`)
    }

    const sent = await payload.findByID({ collection: 'galleries', id: gallery.id, depth: 0, overrideAccess: true })
    expect(sent.clientsNotifiedAt).toBeTruthy()
  })

  it('does not send again when the gallery is saved after the clients were emailed', async () => {
    const gallery = await makeGallery({ status: 'published' })
    await deliver()
    expect(inbox).toHaveLength(2)

    inbox.length = 0
    await payload.update({ collection: 'galleries', id: gallery.id, data: { title: `${PREFIX}renamed` } })
    await deliver()
    expect(inbox).toHaveLength(0)
  })

  it('sends nothing for a draft, or when notification is off', async () => {
    await makeGallery({ status: 'draft' })
    await makeGallery({ status: 'published', notifyClients: false })
    await deliver()
    expect(inbox).toHaveLength(0)
  })

  it('sends from the gallery’s own studio, to its own clients only', async () => {
    const otherClient = await makeUser('other-client', other)
    const gallery = await makeGallery({ tenant: other.id, clients: [otherClient.id], status: 'published' })
    await deliver()

    expect(inbox).toHaveLength(1)
    expect(inbox[0]!.to).toEqual([otherClient.email])
    const raw = decoded(inbox[0]!.raw)
    expect(raw).toContain(`/en/portal/galleries/${gallery.slug}`)
    expect(raw).toContain(other.name)
    expect(raw).not.toContain(studio.name)
  })

  it('releases the claim when no client can be emailed, so a retry sends the link', async () => {
    const gallery = await makeGallery()
    vi.spyOn(payload, 'sendEmail').mockRejectedValue(new Error('mail service down'))
    await payload.update({ collection: 'galleries', id: gallery.id, data: { status: 'published' } })
    await deliver()
    expect(inbox).toHaveLength(0)

    const after = await payload.findByID({ collection: 'galleries', id: gallery.id, depth: 0, overrideAccess: true })
    expect(after.clientsNotifiedAt).toBeFalsy()

    vi.restoreAllMocks()
    const result = await deliverGalleryNotice(payload, gallery.id)
    expect(result).toEqual({ sent: 2, failed: 0 })
    expect(inbox).toHaveLength(2)
  })
})
