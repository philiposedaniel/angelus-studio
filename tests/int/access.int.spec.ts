import { getPayload, type Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import config from '@/payload.config'
import type { User } from '@/payload-types'

const PREFIX = 'int-access-'
const password = 'int-Password-1'

let payload: Payload
let admin: User
let clientA: User
let clientB: User

const makeUser = (name: string, roles: User['roles']) =>
  payload.create({
    collection: 'users',
    data: { email: `${PREFIX}${name}@angelus.test`, password, roles },
  })

const cleanup = () =>
  payload.delete({ collection: 'users', where: { email: { like: PREFIX } } })

describe('authorization', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    await cleanup()
    admin = await makeUser('admin', ['admin'])
    clientA = await makeUser('client-a', ['client'])
    clientB = await makeUser('client-b', ['client'])
  })

  afterAll(async () => {
    await cleanup()
  })

  it('lets a client read only their own user record', async () => {
    const { docs } = await payload.find({
      collection: 'users',
      overrideAccess: false,
      user: clientA,
      where: { email: { like: PREFIX } },
    })
    expect(docs.map((d) => d.id)).toEqual([clientA.id])
  })

  it('refuses a client reading another client by id', async () => {
    await expect(
      payload.findByID({ collection: 'users', id: clientB.id, overrideAccess: false, user: clientA }),
    ).rejects.toThrow()
  })

  it('refuses a client updating another client', async () => {
    await expect(
      payload.update({
        collection: 'users',
        id: clientB.id,
        data: { name: 'hijacked' },
        overrideAccess: false,
        user: clientA,
      }),
    ).rejects.toThrow()
  })

  it('does not let a client grant themselves a staff role', async () => {
    const updated = await payload.update({
      collection: 'users',
      id: clientA.id,
      data: { roles: ['admin'] },
      overrideAccess: false,
      user: clientA,
    })
    expect(updated.roles).toEqual(['client'])
  })

  it('does not let an admin grant super admin', async () => {
    await expect(
      payload.update({
        collection: 'users',
        id: clientB.id,
        data: { roles: ['super-admin'] },
        overrideAccess: false,
        user: admin,
      }),
    ).rejects.toThrow()
  })

  it('refuses anonymous user creation', async () => {
    await expect(
      payload.create({
        collection: 'users',
        data: { email: `${PREFIX}anon@angelus.test`, password, roles: ['client'] },
        overrideAccess: false,
      }),
    ).rejects.toThrow()
  })

  it('hides unpublished services from the public', async () => {
    const draft = await payload.create({
      collection: 'services',
      data: { title: 'Draft service', slug: 'int-draft-service', summary: 'Not live yet' },
    })
    try {
      const { docs } = await payload.find({
        collection: 'services',
        overrideAccess: false,
        where: { slug: { equals: draft.slug } },
      })
      expect(docs).toHaveLength(0)
    } finally {
      await payload.delete({ collection: 'services', id: draft.id })
    }
  })
})
