import fs from 'fs'
import { getPayload, type Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { zipPath } from '@/collections/GalleryDownloads'
import config from '@/payload.config'
import type { Gallery, GalleryPhoto, Tenant, User } from '@/payload-types'

import { testJpeg } from '../helpers/image'
import { ensureTenant } from '../helpers/seedTenant'

const PREFIX = 'int-zip-'
const password = 'int-Password-1'

let payload: Payload
let studioA: Tenant
let studioB: Tenant
let photographerA: User
let photographerB: User
let clientA1: User
let clientA2: User
let open: Gallery
let locked: Gallery
let other: Gallery
let openPhotos: GalleryPhoto[]

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

const makeGallery = (slug: string, tenant: Tenant, data: Partial<Gallery>) =>
  payload.create({
    collection: 'galleries',
    data: { tenant: tenant.id, title: slug, slug: `${PREFIX}${slug}`, status: 'published', ...data },
  })

const addPhoto = async (gallery: Gallery, name: string) =>
  payload.create({
    collection: 'gallery-photos',
    data: { gallery: gallery.id },
    file: await testJpeg(`${PREFIX}${name}.jpg`),
  })

const requestZip = (user: User, gallery: Gallery, scope: 'all' | 'favorites' = 'all') =>
  payload.create({
    collection: 'gallery-downloads',
    data: { gallery: gallery.id, scope } as never,
    user,
    overrideAccess: false,
  })

const cleanup = async () => {
  const downloads = await payload.find({
    collection: 'gallery-downloads',
    where: { 'gallery.slug': { like: PREFIX } },
    pagination: false,
    depth: 0,
  })
  for (const d of downloads.docs) await fs.promises.rm(zipPath(d.id), { force: true })
  await payload.delete({ collection: 'gallery-downloads', where: { id: { in: downloads.docs.map((d) => d.id) } } })
  await payload.delete({ collection: 'gallery-favorites', where: { 'gallery.slug': { like: PREFIX } } })
  await payload.delete({ collection: 'gallery-photos', where: { filename: { like: PREFIX } } })
  await payload.delete({ collection: 'galleries', where: { slug: { like: PREFIX } } })
  await payload.delete({ collection: 'users', where: { email: { like: PREFIX } } })
}

/** Reads the names stored in a ZIP's central directory, enough to check what went in. */
const zipEntries = async (file: string) => {
  const buffer = await fs.promises.readFile(file)
  const names: string[] = []
  for (let i = buffer.indexOf('PK\x01\x02'); i !== -1; i = buffer.indexOf('PK\x01\x02', i + 4)) {
    const nameLength = buffer.readUInt16LE(i + 28)
    names.push(buffer.toString('utf8', i + 46, i + 46 + nameLength))
  }
  return names.sort()
}

describe('gallery ZIP downloads', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    studioA = await ensureTenant(payload, { name: 'Int Studio A', slug: 'int-studio-a' })
    studioB = await ensureTenant(payload, { name: 'Int Studio B', slug: 'int-studio-b' })
    await cleanup()
    photographerA = await makeUser('photographer-a', studioA, ['photographer'])
    photographerB = await makeUser('photographer-b', studioB, ['photographer'])
    clientA1 = await makeUser('client-a1', studioA, ['client'])
    clientA2 = await makeUser('client-a2', studioA, ['client'])

    open = await makeGallery('open', studioA, { clients: [clientA1.id], allowDownloads: true })
    locked = await makeGallery('locked', studioA, { clients: [clientA1.id], allowDownloads: false })
    other = await makeGallery('other', studioA, { clients: [clientA2.id], allowDownloads: true })
    openPhotos = [await addPhoto(open, 'one'), await addPhoto(open, 'two'), await addPhoto(open, 'three')]
    await addPhoto(locked, 'locked-1')
    await addPhoto(other, 'other-1')
  })

  afterAll(async () => {
    await cleanup()
  })

  it('builds a ZIP of the whole gallery in the background', async () => {
    const download = await requestZip(clientA1, open)
    expect(download.status).toBe('queued')
    expect(download.photoCount).toBe(3)
    expect(download.user).toMatchObject({ id: clientA1.id })

    await payload.jobs.run()
    const ready = await payload.findByID({ collection: 'gallery-downloads', id: download.id, depth: 0 })
    expect(ready.status).toBe('ready')
    expect(ready.sizeBytes).toBeGreaterThan(0)
    expect(new Date(ready.expiresAt!).getTime()).toBeGreaterThan(Date.now())
    expect(await zipEntries(zipPath(download.id))).toEqual(
      openPhotos.map((p) => p.filename).sort(),
    )
  })

  it('builds a ZIP of only the client’s favorites', async () => {
    await payload.create({
      collection: 'gallery-favorites',
      data: { photo: openPhotos[1]!.id } as never,
      user: clientA1,
      overrideAccess: false,
    })
    const download = await requestZip(clientA1, open, 'favorites')
    expect(download.photoCount).toBe(1)
    await payload.jobs.run()
    expect(await zipEntries(zipPath(download.id))).toEqual([openPhotos[1]!.filename])
  })

  it('ignores status and owner sent by the client', async () => {
    const download = await payload.create({
      collection: 'gallery-downloads',
      data: { gallery: open.id, user: clientA2.id, status: 'ready' } as never,
      user: clientA1,
      overrideAccess: false,
    })
    expect(download.status).toBe('queued')
    expect(download.user).toMatchObject({ id: clientA1.id })
    await payload.jobs.run()
  })

  it('allows one download in preparation at a time per person', async () => {
    await requestZip(clientA1, open)
    await expect(requestZip(clientA1, open)).rejects.toMatchObject({ status: 429 })
    await payload.jobs.run()
  })

  it('refuses when the studio has not enabled downloads, except for its staff', async () => {
    await expect(requestZip(clientA1, locked)).rejects.toMatchObject({ status: 403 })
    const staff = await requestZip(photographerA, locked)
    expect(staff.photoCount).toBe(1)
    await payload.jobs.run()
  })

  it('refuses galleries the person cannot see, including another studio’s', async () => {
    await expect(requestZip(clientA1, other)).rejects.toMatchObject({ status: 404 })
    await expect(requestZip(photographerB, open)).rejects.toMatchObject({ status: 404 })
  })

  it('refuses anonymous requests', async () => {
    await expect(
      payload.create({
        collection: 'gallery-downloads',
        data: { gallery: open.id } as never,
        overrideAccess: false,
      }),
    ).rejects.toThrow()
  })

  it('shows a download only to its owner and the studio’s staff', async () => {
    const download = await requestZip(clientA1, open)
    await payload.jobs.run()
    const readAs = (user: User) =>
      payload.findByID({ collection: 'gallery-downloads', id: download.id, user, overrideAccess: false })
    await expect(readAs(clientA1)).resolves.toMatchObject({ id: download.id })
    await expect(readAs(photographerA)).resolves.toMatchObject({ id: download.id })
    await expect(readAs(clientA2)).rejects.toThrow()
    await expect(readAs(photographerB)).rejects.toThrow()
  })

  it('does not let anyone change a download after it is requested', async () => {
    const [download] = (
      await payload.find({ collection: 'gallery-downloads', where: { user: { equals: clientA1.id } }, limit: 1 })
    ).docs
    await expect(
      payload.update({
        collection: 'gallery-downloads',
        id: download!.id,
        data: { status: 'ready' },
        user: photographerA,
        overrideAccess: false,
      }),
    ).rejects.toThrow()
  })

  it('deletes expired ZIPs', async () => {
    const download = await requestZip(clientA1, open)
    await payload.jobs.run()
    await payload.update({
      collection: 'gallery-downloads',
      id: download.id,
      data: { expiresAt: new Date(Date.now() - 1000).toISOString() },
    })
    expect(fs.existsSync(zipPath(download.id))).toBe(true)

    await payload.jobs.queue({ task: 'cleanup-gallery-zips', input: {} })
    await payload.jobs.run()
    const after = await payload.findByID({ collection: 'gallery-downloads', id: download.id, depth: 0 })
    expect(after.status).toBe('expired')
    expect(fs.existsSync(zipPath(download.id))).toBe(false)
  })
})
