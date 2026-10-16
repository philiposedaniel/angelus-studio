import { getPayload, type Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import config from '@/payload.config'
import type { Tenant, User } from '@/payload-types'

import { ensureTenant } from '../helpers/seedTenant'

const PREFIX = 'int-call-sheet-'
const password = 'int-Password-1'

let payload: Payload
let studioA: Tenant
let studioB: Tenant
let managerA: User
let managerB: User
let photographerA: User
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
  await payload.delete({ collection: 'projects', where: { title: { like: PREFIX } }, overrideAccess: true })
  await payload.delete({ collection: 'users', where: { email: { like: PREFIX } }, overrideAccess: true })
}

describe('call sheets', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    studioA = await ensureTenant(payload, { name: 'Int Studio A', slug: 'int-studio-a' })
    studioB = await ensureTenant(payload, { name: 'Int Studio B', slug: 'int-studio-b' })
    await cleanup()
    managerA = await makeUser('manager-a', studioA, ['production-manager'])
    managerB = await makeUser('manager-b', studioB, ['production-manager'])
    photographerA = await makeUser('photographer-a', studioA, ['photographer'])

    const project = await payload.create({
      collection: 'projects',
      data: { tenant: studioA.id, title: `${PREFIX}Gala`, clientName: 'Inês Lopes', status: 'confirmed' },
      overrideAccess: true,
    })
    projectId = project.id
  })

  afterAll(cleanup)

  it('saves the meeting point, notes and schedule the production manager plans', async () => {
    const updated = await payload.update({
      collection: 'projects',
      id: projectId,
      user: managerA,
      overrideAccess: false,
      data: {
        callSheet: {
          meetingPoint: 'Hotel lobby, Rua Augusta 10',
          notes: 'Bring the second body.',
          schedule: [
            { time: '07:30', item: 'Arrival and setup', location: 'Hotel' },
            { time: '09:00', item: 'Ceremony', location: 'Church' },
          ],
        },
      },
    })
    expect(updated.callSheet?.meetingPoint).toBe('Hotel lobby, Rua Augusta 10')
    expect(updated.callSheet?.schedule).toHaveLength(2)
    expect(updated.callSheet?.schedule?.[1]?.time).toBe('09:00')
  })

  it('refuses a time that is not 24-hour HH:MM', async () => {
    await expect(
      payload.update({
        collection: 'projects',
        id: projectId,
        data: { callSheet: { schedule: [{ time: '25:00', item: 'Impossible' }] } } as never,
        overrideAccess: true,
      }),
    ).rejects.toThrow()
    await expect(
      payload.update({
        collection: 'projects',
        id: projectId,
        data: { callSheet: { schedule: [{ time: '9am', item: 'Early' }] } } as never,
        overrideAccess: true,
      }),
    ).rejects.toThrow()
  })

  it('keeps the call sheet from other studios and from crew who are not production staff', async () => {
    await expect(
      payload.find({ collection: 'projects', user: managerB, overrideAccess: false, where: { id: { equals: projectId } } }),
    ).resolves.toMatchObject({ docs: [] })
    await expect(
      payload.find({ collection: 'projects', user: photographerA, overrideAccess: false, where: { id: { equals: projectId } } }),
    ).rejects.toThrow()
    await expect(
      payload.update({
        collection: 'projects',
        id: projectId,
        user: photographerA,
        overrideAccess: false,
        data: { callSheet: { notes: 'Changed by a photographer' } },
      }),
    ).rejects.toThrow()
  })
})
