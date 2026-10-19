import { getPayload, type Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import config from '@/payload.config'
import type { Tenant, User } from '@/payload-types'

import { ensureTenant } from '../helpers/seedTenant'

const PREFIX = 'int-project-kit-'
const password = 'int-Password-1'

let payload: Payload
let studioA: Tenant
let managerA: User
let photographerA: User
let clientA: User
let projectId: number
let reservationId: number

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
  await payload.delete({ collection: 'equipment-reservations', where: { notes: { like: PREFIX } }, overrideAccess: true })
  await payload.delete({ collection: 'equipment', where: { name: { like: PREFIX } }, overrideAccess: true })
  await payload.delete({ collection: 'projects', where: { title: { like: PREFIX } }, overrideAccess: true })
  await payload.delete({ collection: 'users', where: { email: { like: PREFIX } }, overrideAccess: true })
}

/** The project read the way the portal and admin read it. */
const readAs = (user: User) =>
  payload.find({
    collection: 'projects',
    user,
    overrideAccess: false,
    where: { title: { equals: `${PREFIX}Gala` } },
    depth: 0,
  })

describe('kit reserved for a production', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    studioA = await ensureTenant(payload, { name: 'Int Studio A', slug: 'int-studio-a' })
    await cleanup()
    managerA = await makeUser('manager-a', studioA, ['production-manager'])
    photographerA = await makeUser('photographer-a', studioA, ['photographer'])
    clientA = await makeUser('client-a', studioA, ['client'])

    const camera = await payload.create({
      collection: 'equipment',
      data: { tenant: studioA.id, name: `${PREFIX}Camera` },
      overrideAccess: true,
    })
    const project = await payload.create({
      collection: 'projects',
      data: {
        tenant: studioA.id,
        title: `${PREFIX}Gala`,
        clientName: 'Inês Lopes',
        status: 'confirmed',
        crew: [{ user: photographerA.id, role: 'Lead photographer' }],
        clientUser: clientA.id,
      } as never,
      overrideAccess: true,
    })
    projectId = project.id
    const reservation = await payload.create({
      collection: 'equipment-reservations',
      data: {
        tenant: studioA.id,
        equipment: camera.id,
        project: projectId,
        startsAt: '2026-12-05T08:00:00.000Z',
        endsAt: '2026-12-05T18:00:00.000Z',
        notes: `${PREFIX}gala day`,
      },
      overrideAccess: true,
    })
    reservationId = reservation.id
  })

  afterAll(cleanup)

  it('shows studio staff the kit reserved for the production', async () => {
    const { docs } = await readAs(managerA)
    expect(docs).toHaveLength(1)
    expect(docs[0]?.id).toBe(projectId)
    expect(docs[0]?.kit?.docs).toEqual([reservationId])
  })

  it('keeps the kit from crew and from the client', async () => {
    const crew = await readAs(photographerA)
    expect(crew.docs).toHaveLength(1)
    expect(crew.docs[0]).not.toHaveProperty('kit')

    const client = await readAs(clientA)
    expect(client.docs).toHaveLength(1)
    expect(client.docs[0]).not.toHaveProperty('kit')
  })
})
