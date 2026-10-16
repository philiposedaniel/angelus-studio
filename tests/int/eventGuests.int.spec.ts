import { getPayload, type Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { idOf } from '@/lib/ids'
import { submitRsvp } from '@/lib/rsvp'
import config from '@/payload.config'
import type { Event, Tenant, User } from '@/payload-types'

import { ensureTenant } from '../helpers/seedTenant'

const PREFIX = 'int-guest-'
const password = 'int-Password-1'

let payload: Payload
let studioA: Tenant
let studioB: Tenant
let managerA: User
let managerB: User
let editorA: User
let clientA: User
let eventA: Event
let eventB: Event

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

const makeEvent = (tenant: Tenant, slug: string, overrides: Record<string, unknown> = {}) =>
  payload.create({
    collection: 'events',
    data: {
      tenant: tenant.id,
      title: `${PREFIX}${slug}`,
      slug: `${PREFIX}${slug}`,
      startsAt: '2027-06-12T15:00:00.000Z',
      timeZone: 'Europe/Lisbon',
      published: true,
      ...overrides,
    } as never,
    overrideAccess: true,
  })

const makeGuest = (event: Event, overrides: Record<string, unknown> = {}) =>
  payload.create({
    collection: 'event-guests',
    data: { event: event.id, name: `${PREFIX}Guest`, partySize: 2, ...overrides } as never,
    overrideAccess: true,
  })

const rsvpForm = (values: Record<string, string>) => {
  const data = new FormData()
  for (const [key, value] of Object.entries(values)) data.set(key, value)
  return data
}

const cleanup = async () => {
  await payload.delete({ collection: 'event-guests', where: { name: { like: PREFIX } } })
  await payload.delete({ collection: 'events', where: { slug: { like: PREFIX } } })
  await payload.delete({ collection: 'users', where: { email: { like: PREFIX } } })
}

describe('event guests and RSVP', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    studioA = await ensureTenant(payload, { name: 'Int Studio A', slug: 'int-studio-a' })
    studioB = await ensureTenant(payload, { name: 'Int Studio B', slug: 'int-studio-b' })
    await cleanup()
    managerA = await makeUser('manager-a', studioA, ['production-manager'])
    managerB = await makeUser('manager-b', studioB, ['production-manager'])
    editorA = await makeUser('editor-a', studioA, ['editor'])
    clientA = await makeUser('client-a', studioA, ['client'])
    eventA = await makeEvent(studioA, 'wedding-a')
    eventB = await makeEvent(studioB, 'wedding-b')
  })

  afterAll(cleanup)

  it('puts a guest in the studio of their event and gives them their own link', async () => {
    const guest = await payload.create({
      collection: 'event-guests',
      data: { event: eventA.id, name: `${PREFIX}Ana`, tenant: studioB.id, inviteToken: 'attacker-chosen' } as never,
      overrideAccess: true,
    })
    expect(idOf(guest.tenant)).toBe(studioA.id)
    expect(guest.inviteToken).toMatch(/^[A-Za-z0-9_-]{32}$/)
    const updated = await payload.update({
      collection: 'event-guests',
      id: guest.id,
      data: { name: `${PREFIX}Ana Maria`, inviteToken: 'attacker-chosen' } as never,
      overrideAccess: true,
    })
    expect(updated.inviteToken).toBe(guest.inviteToken)
  })

  it('keeps guest lists to the studio admins and production managers of that studio', async () => {
    const guest = await makeGuest(eventA, { name: `${PREFIX}Private` })
    const where = { id: { equals: guest.id } }
    const seenByA = await payload.find({ collection: 'event-guests', where, user: managerA, overrideAccess: false })
    expect(seenByA.docs).toHaveLength(1)
    // Refused outright (no role in any studio) or filtered to nothing (staff of another studio).
    for (const user of [managerB, editorA, clientA, undefined]) {
      const seen = await payload
        .find({ collection: 'event-guests', where, user, overrideAccess: false })
        .then((result) => result.docs.length)
        .catch(() => 0)
      expect(seen).toBe(0)
    }

    await expect(
      payload.update({
        collection: 'event-guests',
        id: guest.id,
        data: { rsvpStatus: 'declined' },
        user: managerB,
        overrideAccess: false,
      }),
    ).rejects.toThrow()
    await expect(
      payload.delete({ collection: 'event-guests', id: guest.id, user: managerB, overrideAccess: false }),
    ).rejects.toThrow()
  })

  it('does not let a studio add guests to another studio\'s event', async () => {
    await expect(
      payload.create({
        collection: 'event-guests',
        data: { event: eventB.id, name: `${PREFIX}Intruder`, tenant: studioA.id } as never,
        user: managerA,
        overrideAccess: false,
      }),
    ).rejects.toThrow()
    const own = await payload.create({
      collection: 'event-guests',
      data: { event: eventA.id, name: `${PREFIX}Own`, tenant: studioA.id } as never,
      user: managerA,
      overrideAccess: false,
    })
    // Moving a guest onto another studio's event is refused too.
    await expect(
      payload.update({
        collection: 'event-guests',
        id: own.id,
        data: { event: eventB.id },
        user: managerA,
        overrideAccess: false,
      }),
    ).rejects.toThrow()
  })

  it('refuses more people attending than seats', async () => {
    const guest = await makeGuest(eventA)
    await expect(
      payload.update({
        collection: 'event-guests',
        id: guest.id,
        data: { rsvpStatus: 'attending', attendingCount: 3 },
        overrideAccess: true,
      }),
    ).rejects.toThrow(/seats/)
  })

  it('saves a guest\'s reply from their link and lets them change it', async () => {
    const guest = await makeGuest(eventA, { name: `${PREFIX}Replying` })
    const token = guest.inviteToken!
    const now = Date.parse('2026-11-01T12:00:00Z')

    const yes = await submitRsvp({
      payload,
      tenantId: studioA.id,
      form: rsvpForm({ token, response: 'attending', attendingCount: '2', dietaryNotes: 'Vegetarian' }),
      now,
    })
    expect(yes).toEqual({ status: 'saved', response: 'attending' })
    let saved = await payload.findByID({ collection: 'event-guests', id: guest.id, overrideAccess: true })
    expect(saved).toMatchObject({ rsvpStatus: 'attending', attendingCount: 2, dietaryNotes: 'Vegetarian' })
    expect(saved.respondedAt).toBe(new Date(now).toISOString())

    const no = await submitRsvp({
      payload,
      tenantId: studioA.id,
      form: rsvpForm({ token, response: 'declined' }),
      now,
    })
    expect(no).toEqual({ status: 'saved', response: 'declined' })
    saved = await payload.findByID({ collection: 'event-guests', id: guest.id, overrideAccess: true })
    expect(saved).toMatchObject({ rsvpStatus: 'declined', attendingCount: 0 })

    const tooMany = await submitRsvp({
      payload,
      tenantId: studioA.id,
      form: rsvpForm({ token, response: 'attending', attendingCount: '3' }),
      now,
    })
    expect(tooMany).toEqual({ status: 'error', errors: { attendingCount: 'invalid' } })
  })

  it('refuses a reply on another studio\'s site, with an unknown link, or for an unpublished event', async () => {
    const guest = await makeGuest(eventA, { name: `${PREFIX}Elsewhere` })
    const answer = (tenantId: number, token: string) =>
      submitRsvp({ payload, tenantId, form: rsvpForm({ token, response: 'attending' }) })

    expect(await answer(studioB.id, guest.inviteToken!)).toEqual({ status: 'error', reason: 'failed' })
    expect(await answer(studioA.id, 'A'.repeat(32))).toEqual({ status: 'error', reason: 'failed' })

    const draft = await makeEvent(studioA, 'draft', { published: false })
    const draftGuest = await makeGuest(draft, { name: `${PREFIX}Draft` })
    expect(await answer(studioA.id, draftGuest.inviteToken!)).toEqual({ status: 'error', reason: 'failed' })

    const unchanged = await payload.findByID({ collection: 'event-guests', id: guest.id, overrideAccess: true })
    expect(unchanged.rsvpStatus).toBe('pending')
  })

  it('refuses replies once they are closed or past the deadline', async () => {
    const closed = await makeEvent(studioA, 'closed', { rsvpOpen: false })
    const late = await makeEvent(studioA, 'late', { rsvpDeadline: '2026-10-01T00:00:00.000Z' })
    for (const event of [closed, late]) {
      const guest = await makeGuest(event, { name: `${PREFIX}Late` })
      const result = await submitRsvp({
        payload,
        tenantId: studioA.id,
        form: rsvpForm({ token: guest.inviteToken!, response: 'attending' }),
        now: Date.parse('2026-11-01T12:00:00Z'),
      })
      expect(result).toEqual({ status: 'error', reason: 'closed' })
    }
  })

  it('keeps private events off the public website and removes guests with their event', async () => {
    const hidden = await makeEvent(studioA, 'private', { listed: false })
    const publicView = await payload.find({
      collection: 'events',
      where: { id: { equals: hidden.id } },
      overrideAccess: false,
    })
    expect(publicView.docs).toHaveLength(0)
    const staffView = await payload.find({
      collection: 'events',
      where: { id: { equals: hidden.id } },
      user: managerA,
      overrideAccess: false,
    })
    expect(staffView.docs).toHaveLength(1)

    const guest = await makeGuest(hidden, { name: `${PREFIX}Gone` })
    await payload.delete({ collection: 'events', id: hidden.id, overrideAccess: true })
    const left = await payload.find({ collection: 'event-guests', where: { id: { equals: guest.id } }, overrideAccess: true })
    expect(left.docs).toHaveLength(0)
  })
})
