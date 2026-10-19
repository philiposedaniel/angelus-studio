import { createLocalReq, getPayload, type Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import config from '@/payload.config'
import type { Tenant, User } from '@/payload-types'

import { ensureTenant } from '../helpers/seedTenant'

const PREFIX = 'int-project-form-'
const password = 'int-Password-1'

let payload: Payload
let studioA: Tenant
let studioB: Tenant
let adminA: User
let adminB: User
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
  await payload.delete({ collection: 'projects', where: { title: { like: PREFIX } } })
  await payload.delete({ collection: 'users', where: { email: { like: PREFIX } } })
}

/**
 * Whether the admin's edit form shows a project field to the given user. The form checks each
 * field's read access with the stored project as `data` and no `doc` (see addFieldStatePromise
 * in @payloadcms/ui), which once left staff-only fields empty for the studio's own staff.
 */
const formShows = async (user: User, name: string) => {
  const req = await createLocalReq({ user: { ...user, collection: 'users' } as never }, payload)
  const data = await payload.findByID({
    collection: 'projects',
    id: projectId,
    depth: 0,
    overrideAccess: true,
  })
  const field = payload.collections.projects.config.fields.find(
    (f) => 'name' in f && f.name === name,
  )
  if (!field || !('access' in field) || typeof field.access?.read !== 'function') return true
  return Boolean(await field.access.read({ id: projectId, data, req, siblingData: data }))
}

describe('project edit form in the admin', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    studioA = await ensureTenant(payload, { name: 'Int Studio A', slug: 'int-studio-a' })
    studioB = await ensureTenant(payload, { name: 'Int Studio B', slug: 'int-studio-b' })
    await cleanup()
    adminA = await makeUser('admin-a', studioA, ['admin'])
    adminB = await makeUser('admin-b', studioB, ['admin'])
    photographerA = await makeUser('photographer-a', studioA, ['photographer'])
    const project = await payload.create({
      collection: 'projects',
      data: {
        tenant: studioA.id,
        title: `${PREFIX}Gala`,
        clientName: 'Inês Lopes',
        shootDate: '2026-12-05',
        status: 'confirmed',
        crew: [{ user: photographerA.id, role: 'Lead photographer' }],
      } as never,
      overrideAccess: true,
    })
    projectId = project.id
  })

  afterAll(cleanup)

  it('lets the studio admin see the client, crew and internal fields', async () => {
    for (const name of [
      'clientName',
      'clientEmail',
      'clientUser',
      'quote',
      'notes',
      'crew',
      'tasks',
      'callSheet',
    ]) {
      expect(await formShows(adminA, name), name).toBe(true)
    }
  })

  it('keeps the client and internal fields from crew', async () => {
    expect(await formShows(photographerA, 'crew')).toBe(true)
    for (const name of ['clientName', 'clientEmail', 'notes', 'quote']) {
      expect(await formShows(photographerA, name), name).toBe(false)
    }
  })

  it('gives another studio’s admin none of the project’s fields', async () => {
    for (const name of ['clientName', 'notes', 'crew', 'tasks']) {
      expect(await formShows(adminB, name), name).toBe(false)
    }
  })
})
