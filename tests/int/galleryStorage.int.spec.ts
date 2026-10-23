import fs from 'fs'
import path from 'path'
import { Readable } from 'stream'
import { getPayload, type Payload, type PayloadRequest } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { zipPath } from '@/collections/GalleryDownloads'
import { serveGalleryFile } from '@/collections/GalleryPhotos'
import { setObjectStore, type ObjectStore } from '@/lib/objectStorage'
import { GALLERY_PHOTOS_DIR } from '@/lib/storage'
import config from '@/payload.config'
import type { Gallery, GalleryPhoto, Tenant, User } from '@/payload-types'

import { testJpeg } from '../helpers/image'
import { ensureTenant } from '../helpers/seedTenant'

const PREFIX = 'int-objstore-'
const password = 'int-Password-1'
const S3_ENV = {
  S3_BUCKET: 'int-private-bucket',
  S3_REGION: 'auto',
  S3_ACCESS_KEY_ID: 'int-access-key',
  S3_SECRET_ACCESS_KEY: 'int-secret-key',
}

let payload: Payload
let studio: Tenant
let client: User
let open: Gallery
let watermarked: Gallery
let closed: Gallery
let savedEnv: Record<string, string | undefined>

/** An in-memory stand-in for the bucket, so the upload, signing and ZIP logic run without a network. */
class MemoryStore implements ObjectStore {
  objects = new Map<string, { body: Buffer; contentType: string }>()
  async put(key: string, body: Buffer, contentType: string) {
    this.objects.set(key, { body, contentType })
  }
  async get(key: string) {
    const object = this.objects.get(key)
    if (!object) throw new Error(`No object ${key}`)
    return Readable.from([object.body])
  }
  async delete(key: string) {
    this.objects.delete(key)
  }
  async signedUrl(key: string, expiresInSeconds: number, options?: { downloadName?: string }) {
    const download = options?.downloadName ? `&download=${encodeURIComponent(options.downloadName)}` : ''
    return `https://signed.test/${key}?expires=${expiresInSeconds}${download}`
  }
}

const store = new MemoryStore()

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

const makeGallery = (slug: string, data: Partial<Gallery>) =>
  payload.create({
    collection: 'galleries',
    data: { tenant: studio.id, title: slug, slug: `${PREFIX}${slug}`, status: 'published', ...data },
  })

const addPhoto = async (gallery: Gallery, name: string) =>
  payload.create({ collection: 'gallery-photos', data: { gallery: gallery.id }, file: await testJpeg(`${PREFIX}${name}.jpg`) })

/** The request a Payload file handler sees, reduced to the parts the handler reads. */
const requestAs = (user: User) => ({ payload, user }) as unknown as PayloadRequest

const copyNamed = (photo: GalleryPhoto) => photo.sizes?.web?.filename ?? photo.sizes?.thumbnail?.filename ?? ''

const fileRequest = (user: User, photo: GalleryPhoto, filename: string) =>
  serveGalleryFile(requestAs(user), { doc: photo, params: { filename } })

const cleanup = async () => {
  const downloads = await payload.find({ collection: 'gallery-downloads', where: { 'gallery.slug': { like: PREFIX } }, pagination: false, depth: 0 })
  for (const d of downloads.docs) await fs.promises.rm(zipPath(d.id), { force: true })
  await payload.delete({ collection: 'gallery-downloads', where: { id: { in: downloads.docs.map((d) => d.id) } } })
  await payload.delete({ collection: 'gallery-photos', where: { filename: { like: PREFIX } } })
  await payload.delete({ collection: 'galleries', where: { slug: { like: PREFIX } } })
  await payload.delete({ collection: 'users', where: { email: { like: PREFIX } } })
}

/** The names stored in a ZIP's central directory, enough to check what went in. */
const zipEntries = async (file: string) => {
  const buffer = await fs.promises.readFile(file)
  const names: string[] = []
  for (let i = buffer.indexOf('PK\x01\x02'); i !== -1; i = buffer.indexOf('PK\x01\x02', i + 4)) {
    const nameLength = buffer.readUInt16LE(i + 28)
    names.push(buffer.toString('utf8', i + 46, i + 46 + nameLength))
  }
  return names.sort()
}

describe('gallery photos in object storage', () => {
  beforeAll(async () => {
    savedEnv = Object.fromEntries(Object.keys(S3_ENV).map((key) => [key, process.env[key]]))
    Object.assign(process.env, S3_ENV)
    setObjectStore(store)

    payload = await getPayload({ config: await config })
    studio = await ensureTenant(payload, { name: 'Int Object Store', slug: 'int-object-store' })
    await cleanup()
    client = await makeUser('client', studio, ['client'])
    open = await makeGallery('open', { clients: [client.id], allowDownloads: true })
    watermarked = await makeGallery('watermarked', { clients: [client.id], allowDownloads: true, watermarkText: 'Proof only' })
    closed = await makeGallery('closed', { clients: [client.id], allowDownloads: false })
  })

  afterAll(async () => {
    await cleanup()
    setObjectStore(null)
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })

  it('moves a new photo and its copies into the bucket and removes the local files', async () => {
    const photo = await addPhoto(open, 'moved')
    const names = [photo.filename!, photo.sizes!.thumbnail!.filename!, photo.sizes!.web!.filename!]
    for (const name of names) {
      expect(store.objects.has(`gallery-photos/${name}`)).toBe(true)
      expect(fs.existsSync(path.join(GALLERY_PHOTOS_DIR, name))).toBe(false)
    }
    expect(store.objects.get(`gallery-photos/${photo.filename}`)?.contentType).toBe('image/jpeg')
  })

  it('gives a client who may download the original a short signed link, never cached', async () => {
    const photo = await addPhoto(open, 'original')
    const response = await fileRequest(client, photo, photo.filename!)
    expect(response?.status).toBe(302)
    expect(response?.headers.get('Location')).toBe(
      `https://signed.test/gallery-photos/${photo.filename}?expires=300&download=${encodeURIComponent(photo.filename!)}`,
    )
    expect(response?.headers.get('Cache-Control')).toBe('private, no-store')
  })

  it('gives a viewing copy a link that shows the file rather than saving it', async () => {
    const photo = await addPhoto(open, 'view')
    const copy = photo.sizes?.web?.filename ?? photo.sizes?.thumbnail?.filename
    const response = await fileRequest(client, photo, copy!)
    expect(response?.status).toBe(302)
    expect(response?.headers.get('Location')).not.toContain('download=')
  })

  it('refuses the original to a client when the gallery does not allow downloads', async () => {
    const photo = await addPhoto(closed, 'closed')
    const response = await fileRequest(client, photo, photo.filename!)
    expect(response?.status).toBe(403)
  })

  it('gives a viewing copy as a signed link when the gallery has no watermark', async () => {
    const photo = await addPhoto(open, 'copy')
    const response = await fileRequest(client, photo, copyNamed(photo))
    expect(response?.status).toBe(302)
    expect(response?.headers.get('Location')).toContain(`gallery-photos/${copyNamed(photo)}`)
  })

  it('watermarks a viewing copy from the stored bytes', async () => {
    const photo = await addPhoto(watermarked, 'marked')
    const response = await fileRequest(client, photo, copyNamed(photo))
    expect(response?.status).toBe(200)
    expect(response?.headers.get('Content-Type')).toBe('image/webp')
    const bytes = Buffer.from(await response!.arrayBuffer())
    expect(bytes.toString('ascii', 0, 4)).toBe('RIFF')
    expect(bytes.toString('ascii', 8, 12)).toBe('WEBP')
  })

  it('removes the stored files when the photo is deleted', async () => {
    const photo = await addPhoto(open, 'deleted')
    const names = [photo.filename!, photo.sizes!.thumbnail!.filename!, photo.sizes!.web!.filename!]
    await payload.delete({ collection: 'gallery-photos', id: photo.id })
    for (const name of names) expect(store.objects.has(`gallery-photos/${name}`)).toBe(false)
  })

  it('builds a ZIP of the gallery from the bucket', async () => {
    await addPhoto(open, 'zip-one')
    await addPhoto(open, 'zip-two')
    const download = await payload.create({
      collection: 'gallery-downloads',
      data: { gallery: open.id, scope: 'all' } as never,
      user: client,
      overrideAccess: false,
    })
    await payload.jobs.run()
    const ready = await payload.findByID({ collection: 'gallery-downloads', id: download.id, depth: 0 })
    expect(ready.status).toBe('ready')
    const inGallery = await payload.find({ collection: 'gallery-photos', where: { gallery: { equals: open.id } }, depth: 0, pagination: false })
    expect(await zipEntries(zipPath(download.id))).toEqual(inGallery.docs.map((p) => p.filename!).sort())
  })

  it('leaves photos on the local volume and gives no link when object storage is off', async () => {
    for (const key of Object.keys(S3_ENV)) delete process.env[key]
    try {
      const photo = await addPhoto(open, 'local')
      expect(fs.existsSync(path.join(GALLERY_PHOTOS_DIR, photo.filename!))).toBe(true)
      expect(await fileRequest(client, photo, photo.filename!)).toBeUndefined()
    } finally {
      Object.assign(process.env, S3_ENV)
    }
  })
})
