import { getPayload, type Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { idOf } from '@/lib/ids'
import { issueFormToken, MIN_FILL_MS } from '@/lib/inquiries'
import { isShareToken } from '@/lib/shareTokens'
import { checkInTicket, MAX_REGISTRATIONS_PER_EMAIL_PER_HOUR, submitRegistration } from '@/lib/tickets'
import config from '@/payload.config'
import type { Event, Tenant, TicketType, User } from '@/payload-types'

import { ensureTenant } from '../helpers/seedTenant'

const PREFIX = 'int-tickets-'
const password = 'int-Password-1'
const NOW = Date.now()
const DAY = 86_400_000

let payload: Payload
let studioA: Tenant
let studioB: Tenant
let managerA: User
let managerB: User
let editorA: User
let eventA: Event
let otherEventA: Event
let privateEventA: Event
let eventB: Event
let counter = 0

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

const makeEvent = (tenant: Tenant, slug: string, extra: Record<string, unknown> = {}) =>
  payload.create({
    collection: 'events',
    data: {
      tenant: tenant.id,
      title: `${PREFIX}${slug}`,
      slug: `${PREFIX}${slug}`,
      startsAt: new Date(NOW + 30 * DAY).toISOString(),
      timeZone: 'Europe/Lisbon',
      published: true,
      listed: true,
      ...extra,
    } as never,
    overrideAccess: true,
  })

const makeTicketType = (event: Event, extra: Record<string, unknown> = {}) =>
  payload.create({
    collection: 'ticket-types',
    data: { event: event.id, name: `${PREFIX}General`, capacity: 50, maxPerOrder: 5, ...extra } as never,
    overrideAccess: true,
  })

const makeRegistration = (ticketType: TicketType, extra: Record<string, unknown> = {}) =>
  payload.create({
    collection: 'registrations',
    data: {
      ticketType: ticketType.id,
      name: `${PREFIX}Person`,
      email: `${PREFIX}person${++counter}@example.com`,
      quantity: 1,
      ...extra,
    } as never,
    overrideAccess: true,
  })

/** A filled-in registration form as a person would send it, a few seconds after the page loaded. */
const filled = (tenant: Tenant, ticketType: TicketType, overrides: Record<string, string> = {}) => {
  const data = new FormData()
  const values: Record<string, string> = {
    formToken: issueFormToken(tenant.id, NOW - MIN_FILL_MS - 1000),
    ticketType: String(ticketType.id),
    quantity: '2',
    name: 'Maria Silva',
    email: `${PREFIX}visitor${++counter}@example.com`,
    consent: 'on',
    ...overrides,
  }
  for (const [key, value] of Object.entries(values)) data.set(key, value)
  return data
}

const register = (tenant: Tenant, event: Event, form: FormData, address = `198.51.100.${++counter % 250}`) =>
  submitRegistration({ payload, tenantId: tenant.id, eventId: event.id, locale: 'en', form, address, now: NOW })

const visible = (collection: 'ticket-types' | 'registrations', id: number, user?: User) =>
  payload
    .find({ collection, where: { id: { equals: id } }, user, overrideAccess: false })
    .then((r) => r.docs.length)
    .catch(() => 0)

const cleanup = async () => {
  await payload.delete({ collection: 'events', where: { slug: { like: PREFIX } }, overrideAccess: true })
  await payload.delete({ collection: 'users', where: { email: { like: PREFIX } } })
}

describe('event registration and tickets', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    studioA = await ensureTenant(payload, { name: 'Int Studio A', slug: 'int-studio-a' })
    studioB = await ensureTenant(payload, { name: 'Int Studio B', slug: 'int-studio-b' })
    await cleanup()
    managerA = await makeUser('manager-a', studioA, ['production-manager'])
    managerB = await makeUser('manager-b', studioB, ['production-manager'])
    editorA = await makeUser('editor-a', studioA, ['editor'])
    eventA = await makeEvent(studioA, 'open-day')
    otherEventA = await makeEvent(studioA, 'gala')
    privateEventA = await makeEvent(studioA, 'wedding', { listed: false })
    eventB = await makeEvent(studioB, 'open-day-b')
  })

  afterAll(cleanup)

  it("keeps ticket types and registrations to their own studio's admins and production managers", async () => {
    const ticketType = await makeTicketType(eventA)
    const registration = await makeRegistration(ticketType)
    expect(idOf(ticketType.tenant)).toBe(studioA.id)
    expect(idOf(registration.tenant)).toBe(studioA.id)
    expect(idOf(registration.event)).toBe(eventA.id)

    for (const collection of ['ticket-types', 'registrations'] as const) {
      const id = collection === 'ticket-types' ? ticketType.id : registration.id
      expect(await visible(collection, id, managerA)).toBe(1)
      for (const user of [managerB, editorA, undefined]) expect(await visible(collection, id, user)).toBe(0)
    }
    await expect(
      payload.update({ collection: 'registrations', id: registration.id, data: { quantity: 3 }, user: managerB, overrideAccess: false }),
    ).rejects.toThrow()
    await expect(
      payload.update({ collection: 'ticket-types', id: ticketType.id, data: { capacity: 2 }, user: managerB, overrideAccess: false }),
    ).rejects.toThrow()
    // A manager of another studio cannot put a ticket type on this studio's event, or register on it.
    await expect(
      payload.create({
        collection: 'ticket-types',
        data: { event: eventA.id, name: 'Sneaky', capacity: 5, tenant: studioB.id } as never,
        user: managerB,
        overrideAccess: false,
      }),
    ).rejects.toThrow()
    await expect(
      payload.create({
        collection: 'registrations',
        data: { ticketType: ticketType.id, name: 'Sneaky', email: 'sneaky@example.com', quantity: 1 } as never,
        user: managerB,
        overrideAccess: false,
      }),
    ).rejects.toThrow()
    await expect(
      payload.create({
        collection: 'ticket-types',
        data: { event: eventA.id, name: 'Nope', capacity: 5 } as never,
        user: editorA,
        overrideAccess: false,
      }),
    ).rejects.toThrow()

    // The ticket link is a secret: staff of the studio read it, nobody else.
    const asManager = await payload.findByID({ collection: 'registrations', id: registration.id, user: managerA, overrideAccess: false })
    expect(isShareToken(asManager.ticketToken)).toBe(true)
    expect(asManager).not.toHaveProperty('senderKey')
  })

  it('lets a manager add a ticket type and a registration by hand', async () => {
    const ticketType = await payload.create({
      collection: 'ticket-types',
      data: { event: eventA.id, name: 'Staff added', capacity: 10 } as never,
      user: managerA,
      overrideAccess: false,
    })
    const registration = await payload.create({
      collection: 'registrations',
      data: { ticketType: ticketType.id, name: 'Phone booking', email: `${PREFIX}phone@example.com`, quantity: 4 } as never,
      user: managerA,
      overrideAccess: false,
    })
    expect(registration.status).toBe('confirmed')
    expect(idOf(registration.event)).toBe(eventA.id)
  })

  it('never lets registrations go over capacity, even all at once', async () => {
    const ticketType = await makeTicketType(eventA, { capacity: 3 })
    const results = await Promise.allSettled(Array.from({ length: 6 }, () => makeRegistration(ticketType)))
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(3)
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(3)

    // Cancelling frees a place; confirming it again needs one free.
    const first = (results.find((r) => r.status === 'fulfilled') as PromiseFulfilledResult<{ id: number }>).value
    await payload.update({ collection: 'registrations', id: first.id, data: { status: 'cancelled' }, overrideAccess: true })
    const replacement = await makeRegistration(ticketType)
    await expect(
      payload.update({ collection: 'registrations', id: first.id, data: { status: 'confirmed' }, overrideAccess: true }),
    ).rejects.toThrow(/Not enough places/)
    await expect(
      payload.update({ collection: 'registrations', id: replacement.id, data: { quantity: 2 }, overrideAccess: true }),
    ).rejects.toThrow(/Not enough places/)
  })

  it('refuses lowering capacity below places taken and deleting a ticket type people hold', async () => {
    const ticketType = await makeTicketType(eventA, { capacity: 10 })
    await makeRegistration(ticketType, { quantity: 4 })
    await expect(
      payload.update({ collection: 'ticket-types', id: ticketType.id, data: { capacity: 3 }, overrideAccess: true }),
    ).rejects.toThrow(/already taken/)
    await expect(
      payload.update({ collection: 'ticket-types', id: ticketType.id, data: { capacity: 4 }, overrideAccess: true }),
    ).resolves.toBeTruthy()
    await expect(payload.delete({ collection: 'ticket-types', id: ticketType.id, overrideAccess: true })).rejects.toThrow(
      /registered/,
    )
    await expect(
      payload.update({ collection: 'ticket-types', id: ticketType.id, data: { event: otherEventA.id }, overrideAccess: true }),
    ).rejects.toThrow(/another event/)
  })

  it('registers a visitor and hands back their ticket', async () => {
    const ticketType = await makeTicketType(eventA, { capacity: 5 })
    const result = await register(studioA, eventA, filled(studioA, ticketType, { quantity: '2' }))
    expect(result.status).toBe('registered')
    if (result.status !== 'registered') return
    const { docs } = await payload.find({
      collection: 'registrations',
      where: { ticketToken: { equals: result.token } },
      overrideAccess: true,
    })
    expect(docs[0]).toMatchObject({ name: 'Maria Silva', quantity: 2, status: 'confirmed', language: 'en' })
    expect(idOf(docs[0]!.tenant)).toBe(studioA.id)
  })

  it('checks the form, the ticket type and the places left', async () => {
    const ticketType = await makeTicketType(eventA, { capacity: 3, maxPerOrder: 2 })
    expect(await register(studioA, eventA, filled(studioA, ticketType, { quantity: '3' }))).toMatchObject({
      errors: { quantity: 'invalid' },
    })
    expect(await register(studioA, eventA, filled(studioA, ticketType, { email: 'nope', consent: '' }))).toMatchObject({
      errors: { email: 'invalid', consent: 'required' },
    })
    expect(await register(studioA, eventA, filled(studioA, ticketType, { formToken: 'forged.token' }))).toMatchObject({
      reason: 'expired',
    })
    // A ticket type of another event, or another studio's event, is refused.
    const elsewhere = await makeTicketType(otherEventA)
    expect(await register(studioA, eventA, filled(studioA, elsewhere))).toMatchObject({ errors: { ticketType: 'required' } })
    const otherStudio = await makeTicketType(eventB)
    expect(await register(studioA, eventB, filled(studioA, otherStudio))).toMatchObject({ reason: 'closed' })
    expect(await register(studioA, eventA, filled(studioA, otherStudio))).toMatchObject({ errors: { ticketType: 'required' } })

    expect((await register(studioA, eventA, filled(studioA, ticketType, { quantity: '2' }))).status).toBe('registered')
    expect(await register(studioA, eventA, filled(studioA, ticketType, { quantity: '2' }))).toMatchObject({
      reason: 'notEnough',
      remaining: 1,
    })
    expect((await register(studioA, eventA, filled(studioA, ticketType, { quantity: '1' }))).status).toBe('registered')
    expect(await register(studioA, eventA, filled(studioA, ticketType, { quantity: '1' }))).toMatchObject({ reason: 'soldOut' })
  })

  it('only takes registrations while a ticket is on sale on a public event', async () => {
    const off = await makeTicketType(eventA, { onSale: false })
    const later = await makeTicketType(eventA, { salesStart: new Date(NOW + DAY).toISOString() })
    const over = await makeTicketType(eventA, { salesEnd: new Date(NOW - DAY).toISOString() })
    for (const ticketType of [off, later, over]) {
      expect(await register(studioA, eventA, filled(studioA, ticketType))).toMatchObject({ reason: 'closed' })
    }
    const hidden = await makeTicketType(privateEventA)
    expect(await register(studioA, privateEventA, filled(studioA, hidden))).toMatchObject({ reason: 'closed' })
    const past = await makeEvent(studioA, 'last-year', { startsAt: new Date(NOW - 7 * DAY).toISOString() })
    const pastTicket = await makeTicketType(past)
    expect(await register(studioA, past, filled(studioA, pastTicket))).toMatchObject({ reason: 'closed' })
  })

  it('stops bots and repeated registrations', async () => {
    const ticketType = await makeTicketType(eventA, { capacity: 100 })
    const before = await payload.count({ collection: 'registrations', where: { ticketType: { equals: ticketType.id } }, overrideAccess: true })
    expect((await register(studioA, eventA, filled(studioA, ticketType, { website: 'http://spam.example' }))).status).toBe('error')
    expect(
      (await register(studioA, eventA, filled(studioA, ticketType, { formToken: issueFormToken(studioA.id, NOW - 500) }))).status,
    ).toBe('error')
    const after = await payload.count({ collection: 'registrations', where: { ticketType: { equals: ticketType.id } }, overrideAccess: true })
    expect(after.totalDocs).toBe(before.totalDocs)

    const email = `${PREFIX}repeat@example.com`
    for (let i = 0; i < MAX_REGISTRATIONS_PER_EMAIL_PER_HOUR; i++) {
      expect((await register(studioA, eventA, filled(studioA, ticketType, { email, quantity: '1' }))).status).toBe('registered')
    }
    expect(await register(studioA, eventA, filled(studioA, ticketType, { email, quantity: '1' }))).toMatchObject({
      reason: 'tooMany',
    })
  })

  it("lets only the studio's guest-list staff check a ticket in", async () => {
    const ticketType = await makeTicketType(eventA)
    const registration = await makeRegistration(ticketType, { quantity: 3 })
    const form = (count: string, token = registration.ticketToken!) => {
      const data = new FormData()
      data.set('token', token)
      data.set('count', count)
      return data
    }
    const checkIn = (user: User | null, count: string, tenant = studioA) =>
      checkInTicket({ payload, user, tenantId: tenant.id, form: form(count) })

    expect(await checkIn(null, '2')).toMatchObject({ reason: 'forbidden' })
    expect(await checkIn(editorA, '2')).toMatchObject({ reason: 'forbidden' })
    expect(await checkIn(managerB, '2')).toMatchObject({ reason: 'forbidden' })
    // Staff of another studio, on their own site, cannot find this studio's ticket.
    expect(await checkIn(managerB, '2', studioB)).toMatchObject({ reason: 'invalid' })
    expect(await checkIn(managerA, '4')).toMatchObject({ reason: 'invalid' })
    expect(await checkIn(managerA, '2')).toEqual({ status: 'saved', count: 2 })
    const saved = await payload.findByID({ collection: 'registrations', id: registration.id, overrideAccess: true })
    expect(saved.checkedInCount).toBe(2)
    expect(saved.checkedInAt).toBeTruthy()

    await payload.update({ collection: 'registrations', id: registration.id, data: { status: 'cancelled' }, overrideAccess: true })
    expect(await checkIn(managerA, '1')).toMatchObject({ reason: 'invalid' })
  })

  it("removes an event's ticket types and registrations with it", async () => {
    const event = await makeEvent(studioA, 'one-off')
    const ticketType = await makeTicketType(event)
    await makeRegistration(ticketType)
    await payload.delete({ collection: 'events', id: event.id, overrideAccess: true })
    const left = await payload.count({ collection: 'ticket-types', where: { event: { equals: event.id } }, overrideAccess: true })
    const registrations = await payload.count({ collection: 'registrations', where: { event: { equals: event.id } }, overrideAccess: true })
    expect(left.totalDocs + registrations.totalDocs).toBe(0)
  })
})
