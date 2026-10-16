import { getPayload, type Payload } from 'payload'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import config from '@/payload.config'
import type { Tenant, User } from '@/payload-types'

import { ensureTenant } from '../helpers/seedTenant'

const PREFIX = 'int-project-'
const password = 'int-Password-1'

let payload: Payload
let studioA: Tenant
let studioB: Tenant
let managerA: User
let managerB: User
let editorA: User
let crewA: User
let crewB: User
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

let counter = 0
const makeQuote = async (tenant: Tenant, status: 'sent' | 'draft' = 'sent') =>
  payload.create({
    collection: 'quotes',
    data: {
      tenant: tenant.id,
      title: `${PREFIX}quote ${++counter}`,
      clientName: 'Inês Lopes',
      clientEmail: `${PREFIX}ines@example.com`,
      currency: 'eur',
      lineItems: [{ description: 'Full day', quantity: 1, unitAmount: 20000 }],
      depositPercent: 30,
      status,
    },
    overrideAccess: true,
  })

const markPaid = (quoteId: number) =>
  payload.update({
    collection: 'quotes',
    id: quoteId,
    data: { status: 'deposit-paid' },
    context: { stripePayment: true },
    overrideAccess: true,
  })

const projectData = (tenant: Tenant, overrides: Record<string, unknown> = {}) => ({
  tenant: tenant.id,
  title: `${PREFIX}shoot`,
  clientName: 'Inês Lopes',
  shootDate: '2026-12-05T00:00:00.000Z',
  ...overrides,
})

const cleanup = async () => {
  await payload.delete({ collection: 'projects', where: { title: { like: PREFIX } } })
  await payload.delete({ collection: 'quotes', where: { title: { like: PREFIX } } })
  await payload.delete({ collection: 'users', where: { email: { like: PREFIX } } })
}

describe('projects from paid bookings', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    studioA = await ensureTenant(payload, { name: 'Int Studio A', slug: 'int-studio-a' })
    studioB = await ensureTenant(payload, { name: 'Int Studio B', slug: 'int-studio-b' })
    await cleanup()
    managerA = await makeUser('manager-a', studioA, ['production-manager'])
    managerB = await makeUser('manager-b', studioB, ['production-manager'])
    editorA = await makeUser('editor-a', studioA, ['editor'])
    crewA = await makeUser('crew-a', studioA, ['photographer'])
    crewB = await makeUser('crew-b', studioA, ['videographer'])
    clientA = await makeUser('client-a', studioA, ['client'])
  })

  beforeEach(async () => {
    await payload.delete({ collection: 'projects', where: { title: { like: PREFIX } } })
    await payload.delete({ collection: 'quotes', where: { title: { like: PREFIX } } })
  })

  afterAll(cleanup)

  it('opens one project when a deposit is paid, and not before', async () => {
    const quote = await makeQuote(studioA, 'sent')
    const before = await payload.find({ collection: 'projects', where: { quote: { equals: quote.id } }, overrideAccess: true })
    expect(before.totalDocs).toBe(0)

    await markPaid(quote.id)
    const once = await payload.find({ collection: 'projects', where: { quote: { equals: quote.id } }, overrideAccess: true })
    expect(once.totalDocs).toBe(1)
    expect(once.docs[0]).toMatchObject({
      title: quote.title,
      clientName: 'Inês Lopes',
      clientEmail: quote.clientEmail,
      status: 'planning',
    })
    expect((once.docs[0]!.tenant as Tenant).id).toBe(studioA.id)

    // Paying again, or saving the quote again, does not open a second project.
    await payload.update({ collection: 'quotes', id: quote.id, data: { notes: 'thanks' }, overrideAccess: true })
    await markPaid(quote.id)
    const again = await payload.find({ collection: 'projects', where: { quote: { equals: quote.id } }, overrideAccess: true })
    expect(again.totalDocs).toBe(1)
  })

  it('will not book one crew member on two projects on the same day', async () => {
    await payload.create({
      collection: 'projects',
      data: projectData(studioA, { title: `${PREFIX}first`, crew: [{ user: crewA.id, role: 'Lead photographer' }] }) as never,
      overrideAccess: true,
    })
    await expect(
      payload.create({
        collection: 'projects',
        data: projectData(studioA, {
          title: `${PREFIX}second`,
          shootDate: '2026-12-05T18:00:00.000Z',
          crew: [{ user: crewA.id, role: 'Second shooter' }],
        }) as never,
        overrideAccess: true,
      }),
    ).rejects.toThrow(/already booked/)

    // Another day, or another person, is fine.
    await expect(
      payload.create({
        collection: 'projects',
        data: projectData(studioA, {
          title: `${PREFIX}other-day`,
          shootDate: '2026-12-06T00:00:00.000Z',
          crew: [{ user: crewA.id }],
        }) as never,
        overrideAccess: true,
      }),
    ).resolves.toBeDefined()
    await expect(
      payload.create({
        collection: 'projects',
        data: projectData(studioA, { title: `${PREFIX}other-person`, crew: [{ user: crewB.id }] }) as never,
        overrideAccess: true,
      }),
    ).resolves.toBeDefined()
  })

  it('does not count a project against itself when it is saved again', async () => {
    const project = await payload.create({
      collection: 'projects',
      data: projectData(studioA, { title: `${PREFIX}self`, crew: [{ user: crewB.id }] }) as never,
      overrideAccess: true,
    })
    await expect(
      payload.update({
        collection: 'projects',
        id: project.id,
        data: { status: 'confirmed', tasks: [{ title: 'Send the shot list', done: false }] } as never,
        overrideAccess: true,
      }),
    ).resolves.toMatchObject({ status: 'confirmed' })
  })

  it('will not add crew from another studio', async () => {
    await expect(
      payload.create({
        collection: 'projects',
        data: projectData(studioA, { title: `${PREFIX}foreign`, crew: [{ user: managerB.id }] }) as never,
        overrideAccess: true,
      }),
    ).rejects.toThrow(/members of this studio/)
  })

  it('lets only production staff of the studio read and change projects', async () => {
    const project = await payload.create({
      collection: 'projects',
      data: projectData(studioA, { title: `${PREFIX}private` }) as never,
      overrideAccess: true,
    })
    const seen = (user: User) =>
      payload.find({
        collection: 'projects',
        user,
        overrideAccess: false,
        where: { id: { equals: project.id } },
      })

    expect((await seen(managerA)).docs).toHaveLength(1)
    expect((await seen(managerB)).docs).toHaveLength(0)
    // Editors, crew and clients have no access to the production board at all.
    await expect(seen(editorA)).rejects.toThrow()
    await expect(seen(crewA)).rejects.toThrow()
    await expect(seen(clientA)).rejects.toThrow()

    await expect(
      payload.update({
        collection: 'projects',
        id: project.id,
        data: { status: 'closed' },
        user: editorA,
        overrideAccess: false,
      }),
    ).rejects.toThrow()
  })
})
