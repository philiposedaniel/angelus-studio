import { getPayload, type Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import config from '@/payload.config'
import type { Gallery, GalleryPhoto, Tenant, User } from '@/payload-types'
import { submitSelection } from '@/lib/selections'

import { testJpeg } from '../helpers/image'
import { ensureTenant } from '../helpers/seedTenant'

const PREFIX = 'int-sel-'
const password = 'int-Password-1'

let payload: Payload
let studioA: Tenant
let studioB: Tenant
let photographerA: User
let clientA: User
let clientB: User
let gallery: Gallery
let photos: GalleryPhoto[]

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

const addPhoto = async (name: string) =>
  payload.create({
    collection: 'gallery-photos',
    data: { gallery: gallery.id },
    file: await testJpeg(`${PREFIX}${name}.jpg`),
  })

const favorite = (user: User, photo: GalleryPhoto) =>
  payload.create({
    collection: 'gallery-favorites',
    data: { photo: photo.id },
    user,
    overrideAccess: false,
  })

const selectionFor = async (user: User) => {
  const { docs } = await payload.find({
    collection: 'gallery-selections',
    where: { and: [{ gallery: { equals: gallery.id } }, { user: { equals: user.id } }] },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })
  return docs[0] ?? null
}

const cleanup = async () => {
  await payload.delete({ collection: 'gallery-selections', where: { 'user.email': { like: PREFIX } }, overrideAccess: true })
  await payload.delete({ collection: 'gallery-favorites', where: { 'user.email': { like: PREFIX } }, overrideAccess: true })
  await payload.delete({ collection: 'gallery-photos', where: { filename: { like: PREFIX } }, overrideAccess: true })
  await payload.delete({ collection: 'galleries', where: { slug: { like: PREFIX } }, overrideAccess: true })
  await payload.delete({ collection: 'users', where: { email: { like: PREFIX } }, overrideAccess: true })
}

describe('gallery selections', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    studioA = await ensureTenant(payload, { name: 'Int Studio A', slug: 'int-studio-a' })
    studioB = await ensureTenant(payload, { name: 'Int Studio B', slug: 'int-studio-b' })
    await cleanup()
    photographerA = await makeUser('photographer-a', studioA, ['photographer'])
    clientA = await makeUser('client-a', studioA, ['client'])
    clientB = await makeUser('client-b', studioB, ['client'])
    gallery = await payload.create({
      collection: 'galleries',
      data: {
        tenant: studioA.id,
        title: 'Selection gallery',
        slug: `${PREFIX}gallery`,
        status: 'published',
        clients: [clientA.id],
        selectionLimit: 2,
      },
    })
    photos = [await addPhoto('one'), await addPhoto('two'), await addPhoto('three')]
  })

  afterAll(async () => {
    await cleanup()
  })

  it('stops a client at the gallery limit', async () => {
    await favorite(clientA, photos[0])
    await favorite(clientA, photos[1])
    await expect(favorite(clientA, photos[2])).rejects.toThrow(/allows 2 selected photos/)
  })

  it('refuses to submit an empty selection', async () => {
    const nobody = await makeUser('client-empty', studioA, ['client'])
    await payload.update({ collection: 'galleries', id: gallery.id, data: { clients: [clientA.id, nobody.id] }, overrideAccess: true })
    const result = await submitSelection({ payload, user: nobody, galleryId: gallery.id })
    expect(result).toEqual({ status: 'empty' })
  })

  it('locks the selection once the client submits it, so favorites cannot change', async () => {
    const result = await submitSelection({ payload, user: clientA, galleryId: gallery.id })
    expect(result).toEqual({ status: 'submitted' })
    const selection = await selectionFor(clientA)
    expect(selection?.status).toBe('submitted')
    expect(selection?.submittedAt).toBeTruthy()

    const [liked] = (
      await payload.find({
        collection: 'gallery-favorites',
        where: { user: { equals: clientA.id } },
        depth: 0,
        overrideAccess: true,
      })
    ).docs
    await expect(
      payload.delete({ collection: 'gallery-favorites', id: liked.id, user: clientA, overrideAccess: false }),
    ).rejects.toThrow(/locked/)
    await expect(favorite(clientA, photos[2])).rejects.toThrow(/locked/)
    expect(await submitSelection({ payload, user: clientA, galleryId: gallery.id })).toEqual({ status: 'locked' })
  })

  it('does not let a client change the selection status directly', async () => {
    const selection = await selectionFor(clientA)
    await expect(
      payload.update({
        collection: 'gallery-selections',
        id: selection!.id,
        data: { status: 'approved' },
        user: clientA,
        overrideAccess: false,
      }),
    ).rejects.toThrow()
    expect((await selectionFor(clientA))?.status).toBe('submitted')
  })

  it('asks for changes with feedback, which reopens the selection for the client', async () => {
    const selection = await selectionFor(clientA)
    await expect(
      payload.update({
        collection: 'gallery-selections',
        id: selection!.id,
        data: { status: 'revision-requested' },
        user: photographerA,
        overrideAccess: false,
      }),
    ).rejects.toThrow(/Write what the client should change/)

    await payload.update({
      collection: 'gallery-selections',
      id: selection!.id,
      data: { status: 'revision-requested', feedback: 'Swap the group shots for the couple portraits.' },
      user: photographerA,
      overrideAccess: false,
    })
    const reopened = await selectionFor(clientA)
    expect(reopened?.status).toBe('revision-requested')

    const { docs: [seen] } = await payload.find({
      collection: 'gallery-selections',
      user: clientA,
      overrideAccess: false,
      where: { gallery: { equals: gallery.id } },
      depth: 0,
    })
    expect(seen.feedback).toContain('couple portraits')

    // The client swaps one photo for another, then submits again.
    const [dropped] = (
      await payload.find({
        collection: 'gallery-favorites',
        where: { user: { equals: clientA.id } },
        depth: 0,
        overrideAccess: true,
      })
    ).docs
    await payload.delete({ collection: 'gallery-favorites', id: dropped.id, user: clientA, overrideAccess: false })
    await favorite(clientA, photos[2])
    expect(await submitSelection({ payload, user: clientA, galleryId: gallery.id })).toEqual({ status: 'submitted' })
    expect((await selectionFor(clientA))?.status).toBe('submitted')
  })

  it('approves the selection as final and records when it was approved', async () => {
    const selection = await selectionFor(clientA)
    await payload.update({
      collection: 'gallery-selections',
      id: selection!.id,
      data: { status: 'approved' },
      user: photographerA,
      overrideAccess: false,
    })
    const approved = await selectionFor(clientA)
    expect(approved?.status).toBe('approved')
    expect(approved?.approvedAt).toBeTruthy()
    expect(await submitSelection({ payload, user: clientA, galleryId: gallery.id })).toEqual({ status: 'locked' })
  })

  it('does not show a selection to a client from another studio', async () => {
    const { docs } = await payload.find({
      collection: 'gallery-selections',
      user: clientB,
      overrideAccess: false,
      where: { gallery: { equals: gallery.id } },
      depth: 0,
    })
    expect(docs).toHaveLength(0)
    expect(await submitSelection({ payload, user: clientB, galleryId: gallery.id })).toEqual({ status: 'not-found' })
  })
})
