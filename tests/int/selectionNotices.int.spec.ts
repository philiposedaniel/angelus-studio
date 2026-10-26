import { sql } from '@payloadcms/db-postgres'
import { getPayload, type Payload, type RequiredDataFromCollectionSlug } from 'payload'
import { SMTPServer } from 'smtp-server'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Gallery, GallerySelection, Tenant, User } from '@/payload-types'
import { deliverSelectionNotice } from '@/lib/selectionNotices'
import { submitSelection } from '@/lib/selectionSubmit'
import { runSql } from '@/lib/sqlSession'

import { testJpeg } from '../helpers/image'
import { ensureTenant } from '../helpers/seedTenant'

/**
 * Selection emails go through a real SMTP server started by the test: a submitted selection queues the
 * job, the job writes one message per gallery-staff member of the studio and nodemailer delivers it.
 */

const PREFIX = 'int-sel-notice-'
const password = 'int-Password-1'
const FROM = 'events@selection-notice.test'

type Received = { to: string[]; raw: string }
const inbox: Received[] = []
let server: SMTPServer
const saved = { host: process.env.SMTP_HOST, port: process.env.SMTP_PORT, secure: process.env.SMTP_SECURE, from: process.env.EMAIL_FROM_ADDRESS }

let payload: Payload
let studio: Tenant
let other: Tenant
let photographer: User
let producer: User
let financeManager: User
let otherPhotographer: User
let client: User
let gallery: Gallery
let photos: number[] = []
let counter = 0

/** The message text with quoted-printable soft breaks and escapes undone, enough to find links. */
const decoded = (raw: string) =>
  raw.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))

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

const addPhoto = async () => {
  counter += 1
  const photo = await payload.create({
    collection: 'gallery-photos',
    data: { gallery: gallery.id },
    file: await testJpeg(`${PREFIX}${counter}.jpg`),
  })
  return photo.id
}

const favorite = (user: User, photoId: number) =>
  payload.create({
    collection: 'gallery-favorites',
    data: { photo: photoId } as RequiredDataFromCollectionSlug<'gallery-favorites'>,
    user,
    overrideAccess: false,
  })

const selectionFor = async (user: User): Promise<GallerySelection | null> => {
  const { docs } = await payload.find({
    collection: 'gallery-selections',
    where: { and: [{ gallery: { equals: gallery.id } }, { user: { equals: user.id } }] },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })
  return docs[0] ?? null
}

const mailTo = (address: string) => inbox.filter((mail) => mail.to.includes(address))

const cleanup = async () => {
  await payload.delete({ collection: 'gallery-selections', where: { 'user.email': { like: PREFIX } }, overrideAccess: true })
  await payload.delete({ collection: 'gallery-favorites', where: { 'user.email': { like: PREFIX } }, overrideAccess: true })
  await payload.delete({ collection: 'gallery-photos', where: { filename: { like: PREFIX } }, overrideAccess: true })
  await payload.delete({ collection: 'galleries', where: { slug: { like: PREFIX } }, overrideAccess: true })
  await payload.delete({ collection: 'users', where: { email: { like: PREFIX } }, overrideAccess: true })
}

describe('selection staff emails', () => {
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
    studio = await ensureTenant(payload, { name: 'Int Selection Notice Studio', slug: 'int-selection-notice' })
    other = await ensureTenant(payload, { name: 'Int Selection Notice Other', slug: 'int-selection-notice-other' })
    await cleanup()
    photographer = await makeUser('photographer', studio, ['photographer'])
    producer = await makeUser('producer', studio, ['production-manager'])
    // Studio members who cannot manage galleries are not told about selections.
    financeManager = await makeUser('finance', studio, ['finance-manager'])
    otherPhotographer = await makeUser('other-photographer', other, ['photographer'])
    client = await makeUser('client', studio, ['client'])
    gallery = await payload.create({
      collection: 'galleries',
      data: {
        tenant: studio.id,
        title: `${PREFIX}gallery`,
        slug: `${PREFIX}gallery`,
        status: 'published',
        clients: [client.id],
      },
    })
    photos = [await addPhoto(), await addPhoto()]
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

  it('tells each gallery-staff member of the studio once, and nobody else', async () => {
    await favorite(client, photos[0]!)
    expect(await submitSelection({ payload, user: client, galleryId: gallery.id })).toEqual({ status: 'submitted' })
    await deliver()

    const selection = await selectionFor(client)
    expect(inbox).toHaveLength(2)
    for (const staff of [photographer, producer]) {
      const mails = mailTo(staff.email)
      expect(mails).toHaveLength(1)
      expect(mails[0]!.to).toEqual([staff.email])
      const body = decoded(mails[0]!.raw)
      expect(body).toContain(`From: Int Selection Notice Studio <${FROM}>`)
      expect(body).toContain(`/admin/collections/gallery-selections/${selection!.id}`)
    }
    // Clients, members who cannot manage galleries, and another studio's staff get nothing.
    expect(mailTo(client.email)).toHaveLength(0)
    expect(mailTo(financeManager.email)).toHaveLength(0)
    expect(mailTo(otherPhotographer.email)).toHaveLength(0)
  })

  it('sends nothing more when the job runs again for the same submission', async () => {
    const selection = await selectionFor(client)
    expect(selection?.status).toBe('submitted')
    const result = await deliverSelectionNotice(payload, selection!.id)
    expect(result).toEqual({ sent: 0, failed: 0 })
    await deliver()
    expect(mailTo(photographer.email)).toHaveLength(0)
  })

  it('tells the studio again when the client resubmits after changes were asked for', async () => {
    const selection = await selectionFor(client)
    await payload.update({
      collection: 'gallery-selections',
      id: selection!.id,
      data: { status: 'revision-requested', feedback: 'Swap the second photo.' },
      overrideAccess: true,
    })
    expect(await submitSelection({ payload, user: client, galleryId: gallery.id })).toEqual({ status: 'submitted' })
    await deliver()
    expect(mailTo(photographer.email)).toHaveLength(1)
    expect(mailTo(producer.email)).toHaveLength(1)
  })

  it('releases the claim when every send fails, so the job is tried again', async () => {
    // Ask for changes, then the client submits again: a new submission to announce.
    const selection = await selectionFor(client)
    await payload.update({
      collection: 'gallery-selections',
      id: selection!.id,
      data: { status: 'revision-requested', feedback: 'One more change.' },
      overrideAccess: true,
    })
    await submitSelection({ payload, user: client, galleryId: gallery.id })
    inbox.length = 0

    const spy = vi.spyOn(payload, 'sendEmail').mockRejectedValue(new Error('smtp down'))
    await expect(deliverSelectionNotice(payload, selection!.id)).rejects.toThrow(/no staff member could be emailed/)
    expect(spy).toHaveBeenCalledTimes(2)
    spy.mockRestore()

    const retried = await deliverSelectionNotice(payload, selection!.id)
    expect(retried).toEqual({ sent: 2, failed: 0 })
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(mailTo(photographer.email)).toHaveLength(1)
  })

  it('does not take a notice time from a staff member\'s own request, so the claim cannot be faked', async () => {
    const forger = await makeUser('client-forge', studio, ['client'])
    await payload.update({
      collection: 'galleries',
      id: gallery.id,
      data: { clients: [client.id, forger.id] },
      overrideAccess: true,
    })
    await favorite(forger, photos[0]!)
    expect(await submitSelection({ payload, user: forger, galleryId: gallery.id })).toEqual({ status: 'submitted' })
    const selection = await selectionFor(forger)
    // Start from no claim, then try to set one through the API as a staff member would.
    await runSql(payload, sql`UPDATE gallery_selections SET staff_notice_for = NULL WHERE id = ${selection!.id}`)
    await payload.update({
      collection: 'gallery-selections',
      id: selection!.id,
      data: { staffNoticeFor: selection!.submittedAt } as never,
      user: photographer,
      overrideAccess: false,
    })
    const result = await deliverSelectionNotice(payload, selection!.id)
    expect(result.sent).toBe(2)
  })

  it('queues nothing while email is not set up', async () => {
    delete process.env.SMTP_HOST
    const otherClient = await makeUser('client-quiet', studio, ['client'])
    await payload.update({
      collection: 'galleries',
      id: gallery.id,
      data: { clients: [client.id, otherClient.id] },
      overrideAccess: true,
    })
    await favorite(otherClient, photos[1]!)
    const before = (await payload.count({ collection: 'payload-jobs' })).totalDocs
    expect(await submitSelection({ payload, user: otherClient, galleryId: gallery.id })).toEqual({ status: 'submitted' })
    expect((await payload.count({ collection: 'payload-jobs' })).totalDocs).toBe(before)
  })
})
