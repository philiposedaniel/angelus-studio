import { getPayload, type Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import config from '@/payload.config'
import type { Gallery, GalleryPhoto, Tenant, User } from '@/payload-types'

import { testJpeg } from '../helpers/image'
import { ensureTenant } from '../helpers/seedTenant'

const PREFIX = 'int-gal-'
const password = 'int-Password-1'

let payload: Payload
let studioA: Tenant
let studioB: Tenant
let photographerA: User
let photographerB: User
let clientA1: User
let clientA2: User
let shared: Gallery
let draft: Gallery
let expired: Gallery
let other: Gallery
let sharedPhoto: GalleryPhoto
let otherPhoto: GalleryPhoto

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

const cleanup = async () => {
  await payload.delete({ collection: 'gallery-favorites', where: { 'user.email': { like: PREFIX } } })
  await payload.delete({ collection: 'gallery-photos', where: { filename: { like: PREFIX } } })
  await payload.delete({ collection: 'galleries', where: { slug: { like: PREFIX } } })
  await payload.delete({ collection: 'users', where: { email: { like: PREFIX } } })
}

const visibleGalleryIds = async (user: User | null) => {
  const { docs } = await payload.find({
    collection: 'galleries',
    overrideAccess: false,
    user,
    where: { slug: { like: PREFIX } },
    depth: 0,
  })
  return docs.map((g) => g.id).sort()
}

describe('client galleries', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    studioA = await ensureTenant(payload, { name: 'Int Studio A', slug: 'int-studio-a' })
    studioB = await ensureTenant(payload, { name: 'Int Studio B', slug: 'int-studio-b' })
    await cleanup()
    photographerA = await makeUser('photographer-a', studioA, ['photographer'])
    photographerB = await makeUser('photographer-b', studioB, ['photographer'])
    clientA1 = await makeUser('client-a1', studioA, ['client'])
    clientA2 = await makeUser('client-a2', studioA, ['client'])

    shared = await makeGallery('shared', studioA, { clients: [clientA1.id], allowDownloads: false })
    draft = await makeGallery('draft', studioA, { clients: [clientA1.id], status: 'draft' })
    expired = await makeGallery('expired', studioA, {
      clients: [clientA1.id],
      expiresAt: new Date(Date.now() - 86_400_000).toISOString(),
    })
    other = await makeGallery('other', studioA, { clients: [clientA2.id] })
    sharedPhoto = await addPhoto(shared, 'shared-1')
    otherPhoto = await addPhoto(other, 'other-1')
  })

  afterAll(async () => {
    await cleanup()
  })

  it('shows a client only their published, unexpired galleries', async () => {
    expect(await visibleGalleryIds(clientA1)).toEqual([shared.id])
    expect(await visibleGalleryIds(clientA2)).toEqual([other.id])
  })

  it('shows studio staff all their studio’s galleries, and nothing to another studio', async () => {
    expect(await visibleGalleryIds(photographerA)).toEqual(
      [shared.id, draft.id, expired.id, other.id].sort(),
    )
    expect(await visibleGalleryIds(photographerB)).toEqual([])
  })

  it('refuses anonymous visitors', async () => {
    await expect(visibleGalleryIds(null)).rejects.toThrow()
  })

  it('applies the same rules to photos', async () => {
    const photosFor = async (user: User) =>
      (
        await payload.find({
          collection: 'gallery-photos',
          overrideAccess: false,
          user,
          where: { filename: { like: PREFIX } },
          depth: 0,
        })
      ).docs.map((p) => p.id)
    expect(await photosFor(clientA1)).toEqual([sharedPhoto.id])
    expect(await photosFor(clientA2)).toEqual([otherPhoto.id])
    expect(await photosFor(photographerB)).toEqual([])
  })

  it('creates resized copies and keeps the original', async () => {
    expect(sharedPhoto.filename).toMatch(/\.jpg$/)
    expect(sharedPhoto.sizes?.thumbnail?.filename).toMatch(/\.webp$/)
    expect(sharedPhoto.sizes?.web?.filename).toMatch(/\.webp$/)
  })

  it('files a photo under its gallery’s studio, whatever the uploader sends', async () => {
    expect(typeof sharedPhoto.tenant === 'object' ? sharedPhoto.tenant?.id : sharedPhoto.tenant).toBe(
      studioA.id,
    )
  })

  it('does not let clients or another studio upload or change photos', async () => {
    for (const user of [clientA1, photographerB]) {
      await expect(
        payload.create({
          collection: 'gallery-photos',
          data: { gallery: shared.id },
          file: await testJpeg(`${PREFIX}intruder.jpg`),
          overrideAccess: false,
          user,
        }),
      ).rejects.toThrow()
    }
    await expect(
      payload.update({
        collection: 'galleries',
        id: shared.id,
        data: { clients: [clientA1.id, clientA2.id] },
        overrideAccess: false,
        user: clientA1,
      }),
    ).rejects.toThrow()
  })

  describe('favorites', () => {
    it('lets a client favorite a photo they can see, always as themselves', async () => {
      const favorite = await payload.create({
        collection: 'gallery-favorites',
        data: { photo: sharedPhoto.id, user: clientA2.id, gallery: other.id },
        overrideAccess: false,
        user: clientA1,
      })
      const idOf = (v: unknown) => (typeof v === 'object' && v ? (v as { id: number }).id : v)
      expect(idOf(favorite.user)).toBe(clientA1.id)
      expect(idOf(favorite.gallery)).toBe(shared.id)
      expect(idOf(favorite.tenant)).toBe(studioA.id)
    })

    it('refuses a duplicate favorite', async () => {
      await expect(
        payload.create({
          collection: 'gallery-favorites',
          data: { photo: sharedPhoto.id } as never,
          overrideAccess: false,
          user: clientA1,
        }),
      ).rejects.toThrow()
    })

    it('refuses favoriting a photo from someone else’s gallery', async () => {
      await expect(
        payload.create({
          collection: 'gallery-favorites',
          data: { photo: otherPhoto.id } as never,
          overrideAccess: false,
          user: clientA1,
        }),
      ).rejects.toThrow()
    })

    it('keeps each client’s favorites private from other clients', async () => {
      const { docs } = await payload.find({
        collection: 'gallery-favorites',
        overrideAccess: false,
        user: clientA2,
        where: { gallery: { equals: shared.id } },
      })
      expect(docs).toHaveLength(0)
      const staffView = await payload.find({
        collection: 'gallery-favorites',
        overrideAccess: false,
        user: photographerA,
        where: { gallery: { equals: shared.id } },
      })
      expect(staffView.totalDocs).toBe(1)
    })
  })
})
