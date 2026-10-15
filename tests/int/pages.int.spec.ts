import { getPayload, type Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { findSharedGalleryById } from '@/lib/sharedAlbum'
import config from '@/payload.config'
import type { Page, Tenant, User } from '@/payload-types'

import { ensureTenant } from '../helpers/seedTenant'

const PREFIX = 'int-page-'
const password = 'int-Password-1'

let payload: Payload
let studioA: Tenant
let studioB: Tenant
let editorA: User
let editorB: User
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

const makePage = (slug: string, data: Partial<Page> = {}, user?: User) =>
  payload.create({
    collection: 'pages',
    data: { tenant: studioA.id, title: slug, slug: `${PREFIX}${slug}`, published: true, ...data },
    ...(user ? { user, overrideAccess: false } : {}),
  })

const publicPageSlugs = async (tenant: Tenant) =>
  (
    await payload.find({
      collection: 'pages',
      overrideAccess: false,
      where: { and: [{ tenant: { equals: tenant.id } }, { slug: { like: PREFIX } }] },
    })
  ).docs.map((p) => p.slug)

const cleanup = async () => {
  await payload.delete({ collection: 'pages', where: { slug: { like: PREFIX } } })
  await payload.delete({ collection: 'galleries', where: { slug: { like: PREFIX } } })
  await payload.delete({ collection: 'users', where: { email: { like: PREFIX } } })
}

describe('website pages', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    studioA = await ensureTenant(payload, { name: 'Int Studio A', slug: 'int-studio-a' })
    studioB = await ensureTenant(payload, { name: 'Int Studio B', slug: 'int-studio-b' })
    await cleanup()
    editorA = await makeUser('editor-a', studioA, ['editor'])
    editorB = await makeUser('editor-b', studioB, ['editor'])
    clientA = await makeUser('client-a', studioA, ['client'])
  })

  afterAll(async () => {
    await cleanup()
  })

  it('shows visitors published pages only', async () => {
    await makePage('live')
    await makePage('draft', { published: false })
    expect(await publicPageSlugs(studioA)).toEqual([`${PREFIX}live`])
  })

  it('lets a studio’s editors manage its pages, but not another studio’s or a client', async () => {
    const page = await makePage('owned', {}, editorA)
    expect(page.tenant).toMatchObject({ id: studioA.id })
    const update = (user: User) =>
      payload.update({ collection: 'pages', id: page.id, data: { title: 'x' }, user, overrideAccess: false })
    await expect(update(editorA)).resolves.toBeTruthy()
    await expect(update(editorB)).rejects.toThrow()
    await expect(update(clientA)).rejects.toThrow()
    await expect(makePage('by-client', {}, clientA)).rejects.toThrow()
  })

  it('refuses addresses the website already uses', async () => {
    await expect(
      payload.create({
        collection: 'pages',
        data: { tenant: studioA.id, title: 'Portal', slug: 'portal', published: true },
      }),
    ).rejects.toMatchObject({ data: { errors: [{ path: 'slug', message: expect.stringMatching(/already used/) }] } })
  })

  it('accepts Vimeo, YouTube and Google Photos links and rejects others', async () => {
    const page = await makePage('embeds', {
      layout: [
        { blockType: 'video', url: 'https://vimeo.com/76979871', aspect: '16/9' },
        { blockType: 'video', url: 'https://youtu.be/dQw4w9WgXcQ', aspect: '16/9' },
        { blockType: 'googlePhotos', url: 'https://photos.app.goo.gl/AbCdEf123', title: 'Wedding' },
        { blockType: 'embedCode', code: '<div>hello</div>', title: 'Hello', size: 'fixed', height: 300 },
      ],
    })
    expect(page.layout).toHaveLength(4)

    await expect(
      makePage('bad-video', { layout: [{ blockType: 'video', url: 'https://evil.example/video', aspect: '16/9' }] }),
    ).rejects.toThrow()
    await expect(
      makePage('bad-photos', {
        layout: [{ blockType: 'googlePhotos', url: 'https://evil.example/photos.app.goo.gl/x', title: 'x' }],
      }),
    ).rejects.toThrow()
  })

  it('shows an album block only while its gallery is shared, and only on its own studio’s site', async () => {
    const gallery = await payload.create({
      collection: 'galleries',
      data: { tenant: studioA.id, title: 'Album', slug: `${PREFIX}album`, status: 'published', shareEnabled: true },
    })
    expect((await findSharedGalleryById(studioA, gallery.id))?.gallery.id).toBe(gallery.id)
    expect(await findSharedGalleryById(studioB, gallery.id)).toBeNull()

    await payload.update({ collection: 'galleries', id: gallery.id, data: { shareEnabled: false } })
    expect(await findSharedGalleryById(studioA, gallery.id)).toBeNull()
  })
})
