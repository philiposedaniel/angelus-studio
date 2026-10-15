import { getPayload, type Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import config from '@/payload.config'
import type { Service, Tenant, User } from '@/payload-types'

import { ensureTenant } from '../helpers/seedTenant'

const PREFIX = 'int-access-'
const password = 'int-Password-1'

let payload: Payload
let studioA: Tenant
let studioB: Tenant
let superAdmin: User
let adminA: User
let photographerA: User
let clientA1: User
let clientA2: User
let adminB: User
let serviceB: Service

const member = (tenant: Tenant, roles: NonNullable<User['tenants']>[number]['roles']) => ({
  tenant: tenant.id,
  roles,
})

const makeUser = (name: string, data: Partial<User>) =>
  payload.create({
    collection: 'users',
    data: { email: `${PREFIX}${name}@angelus.test`, password, roles: ['user'], ...data },
  })

/** Re-reads a user so `tenants` matches what the server would see for a logged-in request. */
const asUser = (user: User) =>
  payload.findByID({ collection: 'users', id: user.id, depth: 0 })

const cleanup = async () => {
  await payload.delete({ collection: 'users', where: { email: { like: PREFIX } } })
  await payload.delete({ collection: 'services', where: { slug: { like: 'int-' } } })
}

describe('multi-tenant authorization', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    studioA = await ensureTenant(payload, { name: 'Int Studio A', slug: 'int-studio-a' })
    studioB = await ensureTenant(payload, { name: 'Int Studio B', slug: 'int-studio-b' })
    await cleanup()
    superAdmin = await makeUser('super', { roles: ['super-admin'] })
    adminA = await asUser(await makeUser('admin-a', { tenants: [member(studioA, ['admin'])] }))
    photographerA = await asUser(
      await makeUser('photographer-a', { tenants: [member(studioA, ['photographer'])] }),
    )
    clientA1 = await asUser(await makeUser('client-a1', { tenants: [member(studioA, ['client'])] }))
    clientA2 = await asUser(await makeUser('client-a2', { tenants: [member(studioA, ['client'])] }))
    adminB = await asUser(await makeUser('admin-b', { tenants: [member(studioB, ['admin'])] }))
    serviceB = await payload.create({
      collection: 'services',
      data: { tenant: studioB.id, title: 'B only', slug: 'int-b-only', summary: 'Studio B', published: true },
    })
  })

  afterAll(async () => {
    await cleanup()
  })

  const findUserIds = async (user: User) => {
    const { docs } = await payload.find({
      collection: 'users',
      overrideAccess: false,
      user,
      where: { email: { like: PREFIX } },
      limit: 50,
      depth: 0,
    })
    return docs.map((d) => d.id).sort()
  }

  it('lets a client see only their own account', async () => {
    expect(await findUserIds(clientA1)).toEqual([clientA1.id])
  })

  it('lets a studio admin see the members of their studio only', async () => {
    const ids = await findUserIds(adminA)
    expect(ids).toEqual([adminA.id, photographerA.id, clientA1.id, clientA2.id].sort())
    expect(ids).not.toContain(adminB.id)
  })

  it('refuses a client reading or editing another client', async () => {
    await expect(
      payload.findByID({ collection: 'users', id: clientA2.id, overrideAccess: false, user: clientA1 }),
    ).rejects.toThrow()
    await expect(
      payload.update({
        collection: 'users',
        id: clientA2.id,
        data: { name: 'hijacked' },
        overrideAccess: false,
        user: clientA1,
      }),
    ).rejects.toThrow()
  })

  it('refuses a studio admin editing another studio’s admin', async () => {
    await expect(
      payload.update({
        collection: 'users',
        id: adminB.id,
        data: { name: 'hijacked' },
        overrideAccess: false,
        user: adminA,
      }),
    ).rejects.toThrow()
  })

  it('does not let a user make themselves a platform super admin', async () => {
    const updated = await payload.update({
      collection: 'users',
      id: clientA1.id,
      data: { roles: ['super-admin'] },
      overrideAccess: false,
      user: clientA1,
    })
    expect(updated.roles).toEqual(['user'])
  })

  it('does not let a studio admin join or add people to another studio', async () => {
    await expect(
      payload.update({
        collection: 'users',
        id: adminA.id,
        data: { tenants: [member(studioA, ['admin']), member(studioB, ['admin'])] },
        overrideAccess: false,
        user: adminA,
      }),
    ).rejects.toThrow()
    await expect(
      payload.update({
        collection: 'users',
        id: clientA1.id,
        data: { tenants: [member(studioA, ['client']), member(studioB, ['admin'])] },
        overrideAccess: false,
        user: adminA,
      }),
    ).rejects.toThrow()
  })

  it('lets a studio admin change roles inside their own studio', async () => {
    const updated = await payload.update({
      collection: 'users',
      id: clientA2.id,
      data: { tenants: [member(studioA, ['client', 'event-organizer'])] },
      overrideAccess: false,
      user: adminA,
    })
    expect(updated.tenants?.[0]?.roles).toEqual(['client', 'event-organizer'])
  })

  it('does not let a studio admin change a member’s password or email', async () => {
    await expect(
      payload.update({
        collection: 'users',
        id: clientA1.id,
        data: { password: 'new-Password-2' },
        overrideAccess: false,
        user: adminA,
      }),
    ).rejects.toThrow()
  })

  it('refuses anonymous account creation', async () => {
    await expect(
      payload.create({
        collection: 'users',
        data: { email: `${PREFIX}anon@angelus.test`, password, roles: ['user'] },
        overrideAccess: false,
      }),
    ).rejects.toThrow()
  })

  it('keeps one studio’s content out of another studio’s hands', async () => {
    const { docs } = await payload.find({
      collection: 'services',
      overrideAccess: false,
      user: adminA,
      where: { id: { equals: serviceB.id } },
    })
    expect(docs).toHaveLength(0)
    await expect(
      payload.update({
        collection: 'services',
        id: serviceB.id,
        data: { title: 'hijacked' },
        overrideAccess: false,
        user: adminA,
      }),
    ).rejects.toThrow()
  })

  it('does not let a photographer or client edit website content', async () => {
    for (const user of [photographerA, clientA1]) {
      await expect(
        payload.create({
          collection: 'services',
          data: { tenant: studioA.id, title: 'x', slug: 'int-x', summary: 'x' },
          overrideAccess: false,
          user,
        }),
      ).rejects.toThrow()
    }
  })

  it('refuses a studio admin editing another studio’s site settings', async () => {
    const { docs } = await payload.find({
      collection: 'site-settings',
      where: { tenant: { equals: studioB.id } },
      limit: 1,
    })
    await expect(
      payload.update({
        collection: 'site-settings',
        id: docs[0]!.id,
        data: { companyName: 'hijacked' },
        overrideAccess: false,
        user: adminA,
      }),
    ).rejects.toThrow()
  })

  it('hides unpublished services from the public', async () => {
    const draft = await payload.create({
      collection: 'services',
      data: { tenant: studioA.id, title: 'Draft', slug: 'int-draft', summary: 'Not live yet' },
    })
    const { docs } = await payload.find({
      collection: 'services',
      overrideAccess: false,
      where: { id: { equals: draft.id } },
    })
    expect(docs).toHaveLength(0)
  })

  it('allows the same slug in two studios but not twice in one', async () => {
    const data = { title: 'Weddings', slug: 'int-weddings', summary: 'Wedding films' }
    await payload.create({ collection: 'services', data: { ...data, tenant: studioA.id } })
    await payload.create({ collection: 'services', data: { ...data, tenant: studioB.id } })
    await expect(
      payload.create({ collection: 'services', data: { ...data, tenant: studioA.id } }),
    ).rejects.toThrow()
  })

  it('returns translated content with English fallback', async () => {
    const service = await payload.create({
      collection: 'services',
      locale: 'en',
      data: { tenant: studioA.id, title: 'Live streaming', slug: 'int-live', summary: 'Broadcasts', published: true },
    })
    await payload.update({
      collection: 'services',
      id: service.id,
      locale: 'es',
      data: { title: 'Transmisión en vivo', summary: 'Transmisiones' },
    })
    const es = await payload.findByID({ collection: 'services', id: service.id, locale: 'es' })
    expect(es.title).toBe('Transmisión en vivo')
    // French was never translated, so visitors see the English text rather than nothing.
    const fr = await payload.findByID({ collection: 'services', id: service.id, locale: 'fr' })
    expect(fr.title).toBe('Live streaming')
  })

  it('lets a platform super admin see every studio', async () => {
    const { docs } = await payload.find({
      collection: 'services',
      overrideAccess: false,
      user: superAdmin,
      where: { id: { equals: serviceB.id } },
    })
    expect(docs).toHaveLength(1)
  })
})
