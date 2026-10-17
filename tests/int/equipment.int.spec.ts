import { getPayload, type Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import config from '@/payload.config'
import type { Tenant, User } from '@/payload-types'

import { ensureTenant } from '../helpers/seedTenant'

const PREFIX = 'int-equipment-'
const password = 'int-Password-1'

let payload: Payload
let studioA: Tenant
let studioB: Tenant
let managerA: User
let managerB: User
let clientA: User
let cameraA: number
let cameraB: number
let retiredA: number
let projectA: number
let projectB: number

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

const reserve = (user: User, equipment: number, project: number, startsAt: string, endsAt: string) =>
  payload.create({
    collection: 'equipment-reservations',
    data: { tenant: studioA.id, equipment, project, startsAt, endsAt, notes: PREFIX },
    user,
    overrideAccess: false,
    depth: 0,
  })

describe('equipment reservations', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    studioA = await ensureTenant(payload, { name: 'Int Studio A', slug: 'int-studio-a' })
    studioB = await ensureTenant(payload, { name: 'Int Studio B', slug: 'int-studio-b' })
    await cleanup()
    managerA = await makeUser('manager-a', studioA, ['production-manager'])
    managerB = await makeUser('manager-b', studioB, ['production-manager'])
    clientA = await makeUser('client-a', studioA, ['client'])

    const camA = await payload.create({ collection: 'equipment', data: { tenant: studioA.id, name: `${PREFIX}Camera A` }, overrideAccess: true })
    const camB = await payload.create({ collection: 'equipment', data: { tenant: studioB.id, name: `${PREFIX}Camera B` }, overrideAccess: true })
    const retired = await payload.create({
      collection: 'equipment',
      data: { tenant: studioA.id, name: `${PREFIX}Old light`, active: false },
      overrideAccess: true,
    })
    cameraA = camA.id
    cameraB = camB.id
    retiredA = retired.id
    projectA = (
      await payload.create({
        collection: 'projects',
        data: { tenant: studioA.id, title: `${PREFIX}Gala`, clientName: 'Inês Lopes', status: 'confirmed' },
        overrideAccess: true,
      })
    ).id
    projectB = (
      await payload.create({
        collection: 'projects',
        data: { tenant: studioB.id, title: `${PREFIX}Other gala`, clientName: 'Rui Costa', status: 'confirmed' },
        overrideAccess: true,
      })
    ).id
  })

  afterAll(cleanup)

  it('reserves kit for the studio’s own production', async () => {
    const booked = await reserve(managerA, cameraA, projectA, '2026-11-14T10:00:00.000Z', '2026-11-14T12:00:00.000Z')
    expect(booked.equipment).toBe(cameraA)
    expect(booked.tenant).toBe(studioA.id)
  })

  it('refuses an overlapping reservation of the same kit, and allows one that starts when the last ends', async () => {
    await expect(
      reserve(managerA, cameraA, projectA, '2026-11-14T11:00:00.000Z', '2026-11-14T13:00:00.000Z'),
    ).rejects.toThrow(/already reserved/)
    await expect(
      reserve(managerA, cameraA, projectA, '2026-11-14T12:00:00.000Z', '2026-11-14T14:00:00.000Z'),
    ).resolves.toMatchObject({ equipment: cameraA })
  })

  it('refuses a reservation that ends before it starts', async () => {
    await expect(
      reserve(managerA, cameraA, projectA, '2026-11-15T12:00:00.000Z', '2026-11-15T10:00:00.000Z'),
    ).rejects.toThrow(/must end after it starts/)
  })

  it('refuses retired kit', async () => {
    await expect(
      reserve(managerA, retiredA, projectA, '2026-11-16T10:00:00.000Z', '2026-11-16T12:00:00.000Z'),
    ).rejects.toThrow(/retired/)
  })

  it('refuses kit or a production that belongs to another studio', async () => {
    await expect(
      reserve(managerA, cameraB, projectA, '2026-11-17T10:00:00.000Z', '2026-11-17T12:00:00.000Z'),
    ).rejects.toThrow(/another studio/)
    await expect(
      reserve(managerA, cameraA, projectB, '2026-11-17T10:00:00.000Z', '2026-11-17T12:00:00.000Z'),
    ).rejects.toThrow(/another studio/)
  })

  it('lets two requests for the same kit at once book only one of them', async () => {
    const results = await Promise.allSettled([
      reserve(managerA, cameraA, projectA, '2026-11-20T10:00:00.000Z', '2026-11-20T12:00:00.000Z'),
      reserve(managerA, cameraA, projectA, '2026-11-20T11:00:00.000Z', '2026-11-20T13:00:00.000Z'),
    ])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
  })

  it('keeps reservations to the studio’s production staff', async () => {
    const seenByB = await payload.find({
      collection: 'equipment-reservations',
      user: managerB,
      overrideAccess: false,
      where: { notes: { like: PREFIX } },
    })
    expect(seenByB.docs).toHaveLength(0)
    await expect(
      payload.find({ collection: 'equipment-reservations', user: clientA, overrideAccess: false }),
    ).rejects.toThrow()
  })
})
