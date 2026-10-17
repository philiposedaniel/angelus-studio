import { getPayload, type Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { idOf } from '@/lib/ids'
import { saveGuestFromPortal } from '@/lib/organizerGuests'
import config from '@/payload.config'
import type { Event, EventGuest, Tenant, User } from '@/payload-types'

import { ensureTenant } from '../helpers/seedTenant'

const PREFIX = 'int-organizer-'
const password = 'int-Password-1'

let payload: Payload
let studioA: Tenant
let studioB: Tenant
let hostA: User
let otherClientA: User
let hostB: User
let wedding: Event
let gala: Event
let weddingGuest: EventGuest
let galaGuest: EventGuest

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

const makeEvent = (tenant: Tenant, slug: string, organizers: number[] = []) =>
  payload.create({
    collection: 'events',
    data: {
      tenant: tenant.id,
      title: `${PREFIX}${slug}`,
      slug: `${PREFIX}${slug}`,
      startsAt: '2027-06-12T15:00:00.000Z',
      timeZone: 'Europe/Lisbon',
      published: false,
      organizers,
    },
    overrideAccess: true,
  })

const form = (values: Record<string, string | number>) => {
  const data = new FormData()
  for (const [key, value] of Object.entries(values)) data.set(key, String(value))
  return data
}

const visibleGuests = (eventId: number, user: User) =>
  payload
    .find({ collection: 'event-guests', where: { event: { equals: eventId } }, user, overrideAccess: false })
    .then((r) => r.docs)
    .catch(() => [] as EventGuest[])

const cleanup = async () => {
  await payload.delete({ collection: 'events', where: { slug: { like: PREFIX } }, overrideAccess: true })
  await payload.delete({ collection: 'users', where: { email: { like: PREFIX } } })
}

describe('event organizers managing their guest lists', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    studioA = await ensureTenant(payload, { name: 'Int Studio A', slug: 'int-studio-a' })
    studioB = await ensureTenant(payload, { name: 'Int Studio B', slug: 'int-studio-b' })
    await cleanup()
    hostA = await makeUser('host-a', studioA, ['event-organizer'])
    otherClientA = await makeUser('client-a', studioA, ['client'])
    hostB = await makeUser('host-b', studioB, ['event-organizer'])
    wedding = await makeEvent(studioA, 'wedding', [hostA.id])
    gala = await makeEvent(studioA, 'gala')
    weddingGuest = await payload.create({
      collection: 'event-guests',
      data: { event: wedding.id, name: 'Maria', partySize: 2, language: 'en', rsvpStatus: 'pending', staffNotes: 'VIP, seat near the front' },
      overrideAccess: true,
    })
    galaGuest = await payload.create({
      collection: 'event-guests',
      data: { event: gala.id, name: 'Rui', partySize: 1, language: 'en', rsvpStatus: 'pending' },
      overrideAccess: true,
    })
  })

  afterAll(cleanup)

  it('lets an organizer see their own event\'s guests and links, but not staff notes', async () => {
    const guests = await visibleGuests(wedding.id, hostA)
    expect(guests.map((g) => g.name)).toEqual(['Maria'])
    expect(guests[0]!.inviteToken).toMatch(/^[A-Za-z0-9_-]{32}$/)
    expect(guests[0]!.staffNotes).toBeUndefined()
    const event = await payload.findByID({ collection: 'events', id: wedding.id, user: hostA, overrideAccess: false })
    expect(event.id).toBe(wedding.id)
  })

  it('keeps other events\' guests away from organizers and other clients', async () => {
    expect(await visibleGuests(gala.id, hostA)).toHaveLength(0)
    expect(await visibleGuests(wedding.id, otherClientA)).toHaveLength(0)
    expect(await visibleGuests(wedding.id, hostB)).toHaveLength(0)
    await expect(
      payload.findByID({ collection: 'events', id: gala.id, user: hostA, overrideAccess: false }),
    ).rejects.toThrow()
  })

  it('lets an organizer add, change and remove guests on their event from the portal', async () => {
    const offeredLanguages = ['en'] as const
    const added = await saveGuestFromPortal({
      payload,
      user: hostA,
      offeredLanguages,
      form: form({ intent: 'save', event: wedding.id, name: 'João', email: 'JOAO@example.com', partySize: 3, language: 'en' }),
    })
    expect(added).toEqual({ status: 'saved', action: 'added' })
    const joao = (await visibleGuests(wedding.id, hostA)).find((g) => g.name === 'João')!
    expect(joao.email).toBe('joao@example.com')
    expect(idOf(joao.tenant)).toBe(studioA.id)

    const updated = await saveGuestFromPortal({
      payload,
      user: hostA,
      offeredLanguages,
      form: form({ intent: 'save', event: wedding.id, guest: joao.id, name: 'João Silva', partySize: 2, language: 'en' }),
    })
    expect(updated).toEqual({ status: 'saved', action: 'updated' })

    const removed = await saveGuestFromPortal({
      payload,
      user: hostA,
      offeredLanguages,
      form: form({ intent: 'remove', event: wedding.id, guest: joao.id }),
    })
    expect(removed).toEqual({ status: 'saved', action: 'removed' })
    expect((await visibleGuests(wedding.id, hostA)).map((g) => g.name)).toEqual(['Maria'])
  })

  it('refuses changes to events the organizer does not organize', async () => {
    const offeredLanguages = ['en'] as const
    expect(
      await saveGuestFromPortal({
        payload,
        user: hostA,
        offeredLanguages,
        form: form({ intent: 'save', event: gala.id, name: 'Intruder', partySize: 1, language: 'en' }),
      }),
    ).toMatchObject({ status: 'error' })
    expect(
      await saveGuestFromPortal({
        payload,
        user: hostA,
        offeredLanguages,
        form: form({ intent: 'remove', event: gala.id, guest: galaGuest.id }),
      }),
    ).toMatchObject({ status: 'error' })
    // A guest of another event cannot be reached by pairing it with the organizer's own event.
    expect(
      await saveGuestFromPortal({
        payload,
        user: hostA,
        offeredLanguages,
        form: form({ intent: 'save', event: wedding.id, guest: galaGuest.id, name: 'Moved', partySize: 1, language: 'en' }),
      }),
    ).toMatchObject({ status: 'error' })
    // Nor by moving their own guest onto another event.
    await expect(
      payload.update({ collection: 'event-guests', id: weddingGuest.id, data: { event: gala.id }, user: hostA, overrideAccess: false }),
    ).rejects.toThrow()
    const gala2 = await payload.findByID({ collection: 'event-guests', id: galaGuest.id })
    expect(gala2.name).toBe('Rui')
    expect(await visibleGuests(gala.id, otherClientA)).toHaveLength(0)
  })

  it('does not let organizers write staff notes', async () => {
    await payload.update({
      collection: 'event-guests',
      id: weddingGuest.id,
      data: { staffNotes: 'changed by host' },
      user: hostA,
      overrideAccess: false,
    })
    const saved = await payload.findByID({ collection: 'event-guests', id: weddingGuest.id })
    expect(saved.staffNotes).toBe('VIP, seat near the front')
  })

  it('validates the portal form', async () => {
    const result = await saveGuestFromPortal({
      payload,
      user: hostA,
      offeredLanguages: ['en'],
      form: form({ intent: 'save', event: wedding.id, name: '', email: 'not-an-email', partySize: 99, language: 'xx' }),
    })
    expect(result).toEqual({
      status: 'error',
      errors: { name: 'required', email: 'invalid', partySize: 'invalid', language: 'invalid' },
    })
  })

  it('only accepts organizers who belong to the event\'s studio', async () => {
    await expect(makeEvent(studioA, 'cross', [hostB.id])).rejects.toThrow(/members of this studio/)
  })

  it('stops access once the organizer is taken off the event', async () => {
    await payload.update({ collection: 'events', id: wedding.id, data: { organizers: [] }, overrideAccess: true })
    expect(await visibleGuests(wedding.id, hostA)).toHaveLength(0)
    await payload.update({ collection: 'events', id: wedding.id, data: { organizers: [hostA.id] }, overrideAccess: true })
  })
})
