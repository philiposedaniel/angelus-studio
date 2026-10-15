import { getPayload, type Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { findSharedGallery, findSharedPhotos } from '@/lib/sharedAlbum'
import { isShareToken } from '@/lib/shareTokens'
import config from '@/payload.config'
import type { Gallery, Tenant, User } from '@/payload-types'

import { testJpeg } from '../helpers/image'
import { ensureTenant } from '../helpers/seedTenant'

const PREFIX = 'int-share-'
const password = 'int-Password-1'

let payload: Payload
let studioA: Tenant
let studioB: Tenant
let photographerA: User
let clientA: User

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

const makeGallery = (slug: string, data: Partial<Gallery> = {}) =>
  payload.create({
    collection: 'galleries',
    data: {
      tenant: studioA.id,
      title: slug,
      slug: `${PREFIX}${slug}`,
      status: 'published',
      clients: [clientA.id],
      shareEnabled: true,
      ...data,
    },
  })

const tokenOf = async (id: number) =>
  (await payload.findByID({ collection: 'galleries', id, depth: 0 })).shareToken

const cleanup = async () => {
  await payload.delete({ collection: 'gallery-photos', where: { filename: { like: PREFIX } } })
  await payload.delete({ collection: 'galleries', where: { slug: { like: PREFIX } } })
  await payload.delete({ collection: 'users', where: { email: { like: PREFIX } } })
}

describe('shared albums', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    studioA = await ensureTenant(payload, { name: 'Int Studio A', slug: 'int-studio-a' })
    studioB = await ensureTenant(payload, { name: 'Int Studio B', slug: 'int-studio-b' })
    await cleanup()
    photographerA = await makeUser('photographer-a', studioA, ['photographer'])
    clientA = await makeUser('client-a', studioA, ['client'])
  })

  afterAll(async () => {
    await cleanup()
  })

  it('creates an unguessable link when sharing is turned on, and only then', async () => {
    const shared = await makeGallery('on')
    expect(isShareToken(await tokenOf(shared.id))).toBe(true)
    const unshared = await makeGallery('off', { shareEnabled: false })
    expect(await tokenOf(unshared.id)).toBeNull()
  })

  it('keeps the link across other edits, and revokes it when sharing is turned off', async () => {
    const gallery = await makeGallery('revoke')
    const first = await tokenOf(gallery.id)
    const update = (data: Partial<Gallery>) =>
      payload.update({ collection: 'galleries', id: gallery.id, data, user: photographerA, overrideAccess: false })

    await update({ title: 'Renamed' })
    expect(await tokenOf(gallery.id)).toBe(first)

    await update({ shareEnabled: false })
    expect(await tokenOf(gallery.id)).toBeNull()
    expect(await findSharedGallery(studioA, first!)).toBeNull()

    await update({ shareEnabled: true })
    const second = await tokenOf(gallery.id)
    expect(isShareToken(second)).toBe(true)
    expect(second).not.toBe(first)
  })

  it('never takes a token from the request', async () => {
    const chosen = 'a'.repeat(32)
    const gallery = await payload.create({
      collection: 'galleries',
      data: {
        tenant: studioA.id,
        title: 'x',
        slug: `${PREFIX}chosen`,
        status: 'draft',
        shareEnabled: true,
        shareToken: chosen,
      },
      user: photographerA,
      overrideAccess: false,
    })
    expect(await tokenOf(gallery.id)).not.toBe(chosen)
    await payload.update({
      collection: 'galleries',
      id: gallery.id,
      data: { shareToken: chosen },
      user: photographerA,
      overrideAccess: false,
    })
    expect(await tokenOf(gallery.id)).not.toBe(chosen)
  })

  it('shows the link to studio staff but not to clients', async () => {
    const gallery = await makeGallery('visibility')
    const readAs = (user: User) =>
      payload.findByID({ collection: 'galleries', id: gallery.id, user, overrideAccess: false })
    expect((await readAs(photographerA)).shareToken).toBe(await tokenOf(gallery.id))
    expect((await readAs(clientA)).shareToken).toBeUndefined()
  })

  it('opens only published, unexpired, shared galleries of the studio the link is used on', async () => {
    const valid = await makeGallery('valid')
    const token = (await tokenOf(valid.id))!
    expect((await findSharedGallery(studioA, token))?.id).toBe(valid.id)
    // The same link on another studio's site finds nothing.
    expect(await findSharedGallery(studioB, token)).toBeNull()

    const draft = await makeGallery('draft', { status: 'draft' })
    expect(await findSharedGallery(studioA, (await tokenOf(draft.id))!)).toBeNull()

    const expired = await makeGallery('expired', { expiresAt: new Date(Date.now() - 1000).toISOString() })
    expect(await findSharedGallery(studioA, (await tokenOf(expired.id))!)).toBeNull()

    expect(await findSharedGallery(studioA, 'not-a-token')).toBeNull()
    expect(await findSharedGallery(studioA, token.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A')))).toBeNull()
  })

  it('lists web-size copies through the share link, never original files', async () => {
    const gallery = await makeGallery('photos')
    const token = (await tokenOf(gallery.id))!
    await payload.create({
      collection: 'gallery-photos',
      data: { gallery: gallery.id },
      file: await testJpeg(`${PREFIX}photo.jpg`),
    })
    const { photos } = await findSharedPhotos(gallery, token, 1)
    expect(photos).toHaveLength(1)
    const [photo] = photos
    expect(photo!.thumb.src).toBe(`/s/${token}/p/${photo!.id}/thumbnail`)
    expect(photo!.large.src).toBe(`/s/${token}/p/${photo!.id}/web`)
    expect(JSON.stringify(photo)).not.toContain(`${PREFIX}photo.jpg`)
  })
})
