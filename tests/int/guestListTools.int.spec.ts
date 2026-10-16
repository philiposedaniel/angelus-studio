import { createLocalReq, getPayload, type Payload, type PayloadRequest } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { checkInGuest } from '@/lib/checkIn'
import { exportGuestList, importGuestList } from '@/lib/guestListEndpoints'
import config from '@/payload.config'
import type { Event, EventGuest, Tenant, User } from '@/payload-types'

import { ensureTenant } from '../helpers/seedTenant'

const PREFIX = 'int-guesttools-'
const password = 'int-Password-1'

let payload: Payload
let studioA: Tenant
let studioB: Tenant
let managerA: User
let managerB: User
let editorA: User
let eventA: Event

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

/** A request as the endpoint would get it, signed in as `user`. */
const request = async (user: User | null, options: { query?: Record<string, string>; body?: unknown } = {}) => {
  const req = (await createLocalReq({ user: user ?? undefined }, payload)) as PayloadRequest
  req.user = user ? ({ ...user, collection: 'users' } as PayloadRequest['user']) : null
  ;(req as { searchParams: URLSearchParams }).searchParams = new URLSearchParams(options.query ?? {})
  req.json = async () => options.body
  return req
}

const guestsOf = async (event: Event) =>
  (
    await payload.find({
      collection: 'event-guests',
      where: { event: { equals: event.id } },
      pagination: false,
      overrideAccess: true,
      sort: 'name',
    })
  ).docs

const form = (values: Record<string, string>) => {
  const data = new FormData()
  for (const [key, value] of Object.entries(values)) data.set(key, value)
  return data
}

const cleanup = async () => {
  await payload.delete({ collection: 'events', where: { slug: { like: PREFIX } } })
  await payload.delete({ collection: 'users', where: { email: { like: PREFIX } } })
}

describe('guest list import, export and check-in', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    studioA = await ensureTenant(payload, { name: 'Int Studio A', slug: 'int-studio-a' })
    studioB = await ensureTenant(payload, { name: 'Int Studio B', slug: 'int-studio-b' })
    await cleanup()
    managerA = await makeUser('manager-a', studioA, ['production-manager'])
    managerB = await makeUser('manager-b', studioB, ['production-manager'])
    editorA = await makeUser('editor-a', studioA, ['editor'])
    eventA = await payload.create({
      collection: 'events',
      data: {
        tenant: studioA.id,
        title: `${PREFIX}Gala`,
        slug: `${PREFIX}gala`,
        startsAt: '2027-06-12T15:00:00.000Z',
        timeZone: 'Europe/Lisbon',
        published: true,
      } as never,
      overrideAccess: true,
    })
  })

  afterAll(cleanup)

  const csv = 'Name,Email,Party size\nMaria Silva,maria@example.com,2\nRui Costa,,1\n,broken@example.com,1\n'

  it('previews an import without adding anyone, then adds the valid rows once', async () => {
    const preview = await importGuestList(await request(managerA, { body: { event: eventA.id, csv } }))
    expect(preview.status).toBe(200)
    expect(await preview.json()).toMatchObject({ ready: 2, added: 0, problems: [{ line: 4 }] })
    expect(await guestsOf(eventA)).toHaveLength(0)

    const run = await importGuestList(await request(managerA, { body: { event: eventA.id, csv, dryRun: false } }))
    expect(await run.json()).toMatchObject({ ready: 2, added: 2 })
    const guests = await guestsOf(eventA)
    expect(guests.map((g) => g.name)).toEqual(['Maria Silva', 'Rui Costa'])
    expect(guests[0]!.inviteToken).toMatch(/^[A-Za-z0-9_-]{32}$/)

    // The same file again adds only the guest without an email, who cannot be matched.
    const again = await importGuestList(await request(managerA, { body: { event: eventA.id, csv, dryRun: false } }))
    expect(await again.json()).toMatchObject({ added: 1, duplicates: 1 })
  })

  it('refuses imports and exports from other studios, editors and visitors', async () => {
    const before = (await guestsOf(eventA)).length
    for (const user of [managerB, editorA]) {
      const imported = await importGuestList(await request(user, { body: { event: eventA.id, csv, dryRun: false } }))
      expect([403, 404]).toContain(imported.status)
      const exported = await exportGuestList(await request(user, { query: { event: String(eventA.id) } }))
      expect([403, 404]).toContain(exported.status)
    }
    expect((await importGuestList(await request(null, { body: { event: eventA.id, csv } }))).status).toBe(401)
    expect((await exportGuestList(await request(null, { query: { event: String(eventA.id) } }))).status).toBe(401)
    expect(await guestsOf(eventA)).toHaveLength(before)
  })

  it('exports the guest list as CSV with each invitation link', async () => {
    const response = await exportGuestList(await request(managerA, { query: { event: String(eventA.id) } }))
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/csv')
    const text = await response.text()
    const maria = (await guestsOf(eventA)).find((g) => g.name === 'Maria Silva')!
    expect(text).toContain('Maria Silva,maria@example.com')
    expect(text).toContain(`/invite/${maria.inviteToken}`)
  })

  it('checks a guest in by their code, only for the studio\'s guest-list staff', async () => {
    const maria = (await guestsOf(eventA)).find((g) => g.name === 'Maria Silva') as EventGuest
    const token = maria.inviteToken!

    for (const user of [managerB, editorA, null]) {
      expect(await checkInGuest({ payload, user, tenantId: studioA.id, form: form({ token, count: '1' }) })).toEqual({
        status: 'error',
        reason: 'forbidden',
      })
    }
    // Staff of another studio cannot use the code on their own site either.
    expect(await checkInGuest({ payload, user: managerB, tenantId: studioB.id, form: form({ token, count: '1' }) })).toEqual({
      status: 'error',
      reason: 'invalid',
    })
    expect(await checkInGuest({ payload, user: managerA, tenantId: studioA.id, form: form({ token, count: '3' }) })).toEqual({
      status: 'error',
      reason: 'invalid',
    })

    expect(await checkInGuest({ payload, user: managerA, tenantId: studioA.id, form: form({ token, count: '2' }) })).toEqual({
      status: 'saved',
      count: 2,
    })
    let saved = await payload.findByID({ collection: 'event-guests', id: maria.id, overrideAccess: true })
    expect(saved.checkedInCount).toBe(2)
    expect(saved.checkedInAt).toBeTruthy()

    await checkInGuest({ payload, user: managerA, tenantId: studioA.id, form: form({ token, count: '0' }) })
    saved = await payload.findByID({ collection: 'event-guests', id: maria.id, overrideAccess: true })
    expect(saved.checkedInCount).toBe(0)
    expect(saved.checkedInAt).toBeNull()
  })
})
