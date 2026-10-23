import fs from 'fs'
import path from 'path'
import { Readable } from 'stream'
import { getPayload, type Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { moveLocalGalleryFilesToStorage } from '@/lib/galleryBackfill'
import { setObjectStore, type ObjectStore } from '@/lib/objectStorage'
import { GALLERY_PHOTOS_DIR } from '@/lib/storage'
import config from '@/payload.config'
import type { Gallery, GalleryPhoto, Tenant } from '@/payload-types'

import { testJpeg } from '../helpers/image'
import { ensureTenant } from '../helpers/seedTenant'

const PREFIX = 'int-backfill-'
const S3_ENV = {
  S3_BUCKET: 'int-backfill-bucket',
  S3_REGION: 'auto',
  S3_ACCESS_KEY_ID: 'int-access-key',
  S3_SECRET_ACCESS_KEY: 'int-secret-key',
}

let payload: Payload
let studio: Tenant
let gallery: Gallery
let savedEnv: Record<string, string | undefined>
const objects = new Map<string, Buffer>()

/** An in-memory bucket, so the backfill runs without a network. */
const store: ObjectStore = {
  async put(key, body) {
    objects.set(key, body)
  },
  async get(key) {
    const object = objects.get(key)
    if (!object) throw new Error(`No object ${key}`)
    return Readable.from([object])
  },
  async delete(key) {
    objects.delete(key)
  },
  async signedUrl(key) {
    return `https://signed.test/${key}`
  },
}

const localPath = (name: string) => path.join(GALLERY_PHOTOS_DIR, name)

const cleanup = async () => {
  const photos = await payload.find({ collection: 'gallery-photos', where: { filename: { like: PREFIX } }, depth: 0, pagination: false })
  await payload.delete({ collection: 'gallery-photos', where: { id: { in: photos.docs.map((p) => p.id) } } })
  await payload.delete({ collection: 'galleries', where: { slug: { like: PREFIX } } })
}

const namesOf = (photo: GalleryPhoto) => [photo.filename!, photo.sizes!.thumbnail!.filename!, photo.sizes!.web!.filename!]

describe('moving photos from the local disk into object storage', () => {
  beforeAll(async () => {
    savedEnv = Object.fromEntries(Object.keys(S3_ENV).map((key) => [key, process.env[key]]))
    for (const key of Object.keys(S3_ENV)) delete process.env[key]
    payload = await getPayload({ config: await config })
    studio = await ensureTenant(payload, { name: 'Int Backfill', slug: 'int-backfill' })
    await cleanup()
    gallery = await payload.create({
      collection: 'galleries',
      data: { tenant: studio.id, title: 'backfill', slug: `${PREFIX}gallery`, status: 'published' },
    })
  })

  afterAll(async () => {
    await cleanup()
    setObjectStore(null)
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })

  it('refuses to run until object storage is set up', async () => {
    await expect(moveLocalGalleryFilesToStorage(payload)).rejects.toThrow('Set S3_BUCKET')
  })

  it('moves photos uploaded before storage was on, then does nothing on a second run', async () => {
    // Uploaded while storage is off, so the files are on the local disk.
    const photo = await payload.create({
      collection: 'gallery-photos',
      data: { gallery: gallery.id },
      file: await testJpeg(`${PREFIX}before.jpg`),
    })
    for (const name of namesOf(photo)) expect(fs.existsSync(localPath(name))).toBe(true)

    Object.assign(process.env, S3_ENV)
    setObjectStore(store)
    const first = await moveLocalGalleryFilesToStorage(payload)
    expect(first.moved).toBeGreaterThanOrEqual(3)
    for (const name of namesOf(photo)) {
      expect(objects.has(`gallery-photos/${name}`)).toBe(true)
      expect(fs.existsSync(localPath(name))).toBe(false)
    }

    const second = await moveLocalGalleryFilesToStorage(payload)
    expect(second.moved).toBe(0)
    expect(second.alreadyStored).toBeGreaterThanOrEqual(3)
  })
})
