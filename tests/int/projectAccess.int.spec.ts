import { getPayload, type Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import config from '@/payload.config'
import type { Tenant, User } from '@/payload-types'

import { ensureTenant } from '../helpers/seedTenant'

const PREFIX = 'int-project-access-'
const password = 'int-Password-1'

let payload: Payload
let studioA: Tenant
let studioB: Tenant
let photographerA: User
let otherPhotographerA: User
let clientA: User
let otherClientA: User
let crewB: User
let clientB: User
let projectId: number

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

const cleanup = async () => {
  await payload.delete({ collection: 'projects', where: { title: { like: PREFIX } } })
  await payload.delete({ collection: 'users', where: { email: { like: PREFIX } } })
}

/** What a signed-in user sees of the project, read the way the portal reads it. */
const readAs = (user: User) =>
  payload.find({
    collection: 'projects',
    user,
    overrideAccess: false,
    where: { title: { equals: `${PREFIX}Gala` } },
    depth: 0,
  })

describe('project access for crew and clients', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    studioA = await ensureTenant(payload, { name: 'Int Studio A', slug: 'int-studio-a' })
    studioB = await ensureTenant(payload, { name: 'Int Studio B', slug: 'int-studio-b' })
    await cleanup()
    photographerA = await makeUser('photographer-a', studioA, ['photographer'])
    otherPhotographerA = await makeUser('other-photographer-a', studioA, ['photographer'])
    clientA = await makeUser('client-a', studioA, ['client'])
    otherClientA = await makeUser('other-client-a', studioA, ['client'])
    crewB = await makeUser('crew-b', studioB, ['photographer'])
    clientB = await makeUser('client-b', studioB, ['client'])

    const project = await payload.create({
      collection: 'projects',
      data: {
        tenant: studioA.id,
        title: `${PREFIX}Gala`,
        clientName: 'Inês Lopes',
        clientEmail: `${PREFIX}ines@example.com`,
        shootDate: '2026-12-05',
        location: 'Lisbon',
        status: 'confirmed',
        notes: `${PREFIX}internal note`,
        crew: [{ user: photographerA.id, role: 'Lead photographer' }],
        tasks: [{ title: `${PREFIX}edit`, done: false }],
        clientUser: clientA.id,
      } as never,
      overrideAccess: true,
    })
    projectId = project.id
  })

  afterAll(cleanup)

  it('lets a crew member read their project, with the crew and tasks but not the internal notes', async () => {
    const { docs } = await readAs(photographerA)
    expect(docs).toHaveLength(1)
    expect(docs[0]?.crew).toHaveLength(1)
    expect(docs[0]?.tasks).toHaveLength(1)
    expect(docs[0]).not.toHaveProperty('notes')
    expect(docs[0]).not.toHaveProperty('clientEmail')
  })

  it('does not show a project to a member of the studio who is not on it', async () => {
    const { docs } = await readAs(otherPhotographerA)
    expect(docs).toHaveLength(0)
  })

  it('lets the assigned client read their project without the crew, tasks or internal notes', async () => {
    const { docs } = await readAs(clientA)
    expect(docs).toHaveLength(1)
    expect(docs[0]?.title).toBe(`${PREFIX}Gala`)
    expect(docs[0]?.status).toBe('confirmed')
    expect(docs[0]?.shootDate).toBeTruthy()
    expect(docs[0]?.crew ?? []).toEqual([])
    expect(docs[0]?.tasks ?? []).toEqual([])
    expect(docs[0]).not.toHaveProperty('notes')
    expect(docs[0]).not.toHaveProperty('clientUser')
  })

  it('does not show a project to another client of the same studio', async () => {
    const { docs } = await readAs(otherClientA)
    expect(docs).toHaveLength(0)
  })

  it('does not show a studio’s project to anyone of another studio', async () => {
    expect((await readAs(crewB)).docs).toHaveLength(0)
    expect((await readAs(clientB)).docs).toHaveLength(0)
  })

  it('does not let crew or clients change their project', async () => {
    await expect(
      payload.update({
        collection: 'projects',
        id: projectId,
        user: photographerA,
        overrideAccess: false,
        data: { status: 'delivered' },
      }),
    ).rejects.toThrow()
    await expect(
      payload.update({
        collection: 'projects',
        id: projectId,
        user: clientA,
        overrideAccess: false,
        data: { location: 'Porto' },
      }),
    ).rejects.toThrow()
    const unchanged = await payload.findByID({ collection: 'projects', id: projectId, overrideAccess: true })
    expect(unchanged.status).toBe('confirmed')
    expect(unchanged.location).toBe('Lisbon')
  })

  it('will not assign a client from another studio to a project', async () => {
    await expect(
      payload.update({
        collection: 'projects',
        id: projectId,
        data: { clientUser: clientB.id } as never,
        overrideAccess: true,
      }),
    ).rejects.toThrow(/studio/i)
  })
})
