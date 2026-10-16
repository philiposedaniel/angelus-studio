import { getPayload, type Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import config from '@/payload.config'
import type { Tenant, User } from '@/payload-types'

import { ensureTenant } from '../helpers/seedTenant'

const PREFIX = 'int-event-'
const password = 'int-Password-1'

let payload: Payload
let studioA: Tenant
let studioB: Tenant
let managerA: User
let managerB: User
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

const eventData = (tenant: Tenant, overrides: Record<string, unknown> = {}) => ({
  tenant: tenant.id,
  title: `${PREFIX}Gala`,
  slug: `${PREFIX}gala`,
  startsAt: '2026-11-14T18:00:00.000Z',
  timeZone: 'Europe/Lisbon',
  published: true,
  ...overrides,
})

const cleanup = async () => {
  await payload.delete({ collection: 'events', where: { title: { like: PREFIX } } })
  await payload.delete({ collection: 'users', where: { email: { like: PREFIX } } })
}

describe('events', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    studioA = await ensureTenant(payload, { name: 'Int Studio A', slug: 'int-studio-a' })
    studioB = await ensureTenant(payload, { name: 'Int Studio B', slug: 'int-studio-b' })
    await cleanup()
    managerA = await makeUser('manager-a', studioA, ['production-manager'])
    managerB = await makeUser('manager-b', studioB, ['production-manager'])
    clientA = await makeUser('client-a', studioA, ['client'])
  })

  afterAll(cleanup)

  it('gives every event its own guest token, never one from the request', async () => {
    const event = await payload.create({
      collection: 'events',
      data: eventData(studioA, { guestToken: 'attacker-chosen' }) as never,
      overrideAccess: true,
    })
    expect(event.guestToken).toMatch(/^[A-Za-z0-9_-]{32}$/)
    expect(event.guestToken).not.toBe('attacker-chosen')
    const updated = await payload.update({
      collection: 'events',
      id: event.id,
      data: { title: `${PREFIX}Gala night`, guestToken: 'attacker-chosen' } as never,
      overrideAccess: true,
    })
    expect(updated.guestToken).toBe(event.guestToken)
  })

  it('refuses an event that ends before it starts, an unknown time zone, or a non-video live link', async () => {
    await expect(
      payload.create({
        collection: 'events',
        data: eventData(studioA, { slug: `${PREFIX}bad-end`, endsAt: '2026-11-14T10:00:00.000Z' }) as never,
        overrideAccess: true,
      }),
    ).rejects.toThrow(/must end after it starts/)
    await expect(
      payload.create({
        collection: 'events',
        data: eventData(studioA, { slug: `${PREFIX}bad-zone`, timeZone: 'Mars/Olympus' }) as never,
        overrideAccess: true,
      }),
    ).rejects.toThrow(/Time Zone/i)
    await expect(
      payload.create({
        collection: 'events',
        data: eventData(studioA, { slug: `${PREFIX}bad-live`, livestreamUrl: 'https://example.com/live' }) as never,
        overrideAccess: true,
      }),
    ).rejects.toThrow(/Livestream/i)
  })

  it('shows published events to the public, without the guest token', async () => {
    await payload.create({
      collection: 'events',
      data: eventData(studioA, { slug: `${PREFIX}public`, published: true }) as never,
      overrideAccess: true,
    })
    await payload.create({
      collection: 'events',
      data: eventData(studioA, { slug: `${PREFIX}draft`, published: false }) as never,
      overrideAccess: true,
    })
    const publicList = await payload.find({
      collection: 'events',
      overrideAccess: false,
      where: { title: { like: PREFIX } },
      pagination: false,
    })
    expect(publicList.docs.map((e) => e.slug).sort()).toEqual([`${PREFIX}gala`, `${PREFIX}public`].sort())
    for (const event of publicList.docs) expect(event).not.toHaveProperty('guestToken')
  })

  it('keeps events and guest tokens to their own studio staff', async () => {
    await payload.create({ collection: 'events', data: eventData(studioA, { slug: `${PREFIX}own` }) as never, overrideAccess: true })
    const seenByA = await payload.find({
      collection: 'events',
      user: managerA,
      overrideAccess: false,
      where: { slug: { equals: `${PREFIX}own` } },
    })
    expect(seenByA.docs[0]?.guestToken).toMatch(/^[A-Za-z0-9_-]{32}$/)

    const seenByB = await payload.find({
      collection: 'events',
      user: managerB,
      overrideAccess: false,
      where: { slug: { equals: `${PREFIX}own` } },
    })
    expect(seenByB.docs).toHaveLength(0)

    // A client of the studio sees only published events, and never the guest token.
    const seenByClient = await payload.find({
      collection: 'events',
      user: clientA,
      overrideAccess: false,
      where: { slug: { equals: `${PREFIX}own` } },
    })
    expect(seenByClient.docs.every((e) => !('guestToken' in e) || !e.guestToken)).toBe(true)
  })

  it('does not let a studio create events for another studio', async () => {
    await expect(
      payload.create({
        collection: 'events',
        data: eventData(studioB, { slug: `${PREFIX}other` }) as never,
        user: managerA,
        overrideAccess: false,
      }),
    ).rejects.toThrow()
  })

  it('does not let a website page take the events address', async () => {
    await expect(
      payload.create({
        collection: 'pages',
        data: { tenant: studioA.id, title: `${PREFIX}page`, slug: 'events', published: false } as never,
        overrideAccess: true,
      }),
    ).rejects.toThrow(/Slug/)
  })
})
