import { getPayload, type Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { idOf } from '@/lib/ids'
import { issueFormToken, MIN_FILL_MS } from '@/lib/inquiries'
import { isShareToken } from '@/lib/shareTokens'
import { placesTaken, submitRegistration, ticketOffers, type TicketCheckout } from '@/lib/tickets'
import {
  claimWaitlistPlaces,
  findWaitlistEntry,
  joinWaitlist,
  leaveWaitlist,
  refreshWaitlist,
  WAITLIST_OFFER_MS,
  waitlistPosition,
} from '@/lib/waitlist'
import config from '@/payload.config'
import type { Event, Registration, Tenant, TicketType, User } from '@/payload-types'

import { ensureTenant } from '../helpers/seedTenant'

const PREFIX = 'int-waitlist-'
const password = 'int-Password-1'
const NOW = Date.now()
const DAY = 86_400_000
const originalSecrets = { key: process.env.STRIPE_SECRET_KEY, webhook: process.env.STRIPE_WEBHOOK_SECRET }

let payload: Payload
let studioA: Tenant
let studioB: Tenant
let managerA: User
let managerB: User
let event: Event
let counter = 0
const checkouts: TicketCheckout[] = []

const fakeCheckout = async (checkout: TicketCheckout) => {
  checkouts.push(checkout)
  return { id: `${PREFIX}cs_${++counter}`, url: `https://checkout.stripe.test/${counter}` }
}

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

const makeTicketType = (extra: Record<string, unknown> = {}) =>
  payload.create({
    collection: 'ticket-types',
    data: { event: event.id, name: `${PREFIX}Workshop`, capacity: 3, maxPerOrder: 4, ...extra } as never,
    overrideAccess: true,
  })

/** Fills a ticket type with confirmed registrations of one place each. */
const fill = async (ticketType: TicketType) => {
  const made: Registration[] = []
  for (let n = 0; n < (ticketType.capacity ?? 0); n++) {
    made.push(
      await payload.create({
        collection: 'registrations',
        data: { ticketType: ticketType.id, name: 'Early bird', email: `${PREFIX}early${++counter}@example.com`, quantity: 1 } as never,
        overrideAccess: true,
      }),
    )
  }
  return made
}

const form = (ticketType: TicketType, overrides: Record<string, string> = {}, tenant = studioA) => {
  const data = new FormData()
  const values: Record<string, string> = {
    formToken: issueFormToken(tenant.id, NOW - MIN_FILL_MS - 1000),
    ticketType: String(ticketType.id),
    quantity: '1',
    name: 'Maria Silva',
    email: `${PREFIX}visitor${++counter}@example.com`,
    consent: 'on',
    ...overrides,
  }
  for (const [key, value] of Object.entries(values)) data.set(key, value)
  return data
}

const join = (ticketType: TicketType, overrides: Record<string, string> = {}, tenant = studioA) =>
  joinWaitlist({
    payload,
    tenantId: tenant.id,
    eventId: event.id,
    locale: 'en',
    form: form(ticketType, overrides, tenant),
    address: `203.0.113.${++counter % 250}`,
  })

const tokenOf = (result: Awaited<ReturnType<typeof join>>) => {
  if (result.status !== 'joined') throw new Error(`Not joined: ${JSON.stringify(result)}`)
  return result.token
}

const entryOf = async (token: string) =>
  (await payload.find({ collection: 'waitlist-entries', where: { claimToken: { equals: token } }, overrideAccess: true })).docs[0]!

const register = (ticketType: TicketType) =>
  submitRegistration({
    payload,
    tenantId: studioA.id,
    eventId: event.id,
    locale: 'en',
    form: form(ticketType),
    address: `198.51.100.${++counter % 250}`,
  })

const cancel = (registration: Registration) =>
  payload.update({ collection: 'registrations', id: registration.id, data: { status: 'cancelled' }, overrideAccess: true })

const claim = (token: string, tenant = studioA, now?: number) =>
  claimWaitlistPlaces({ payload, tenantId: tenant.id, token, origin: 'https://studio.test', createCheckout: fakeCheckout, now })

const cleanup = async () => {
  await payload.delete({ collection: 'payments', where: { stripeSessionId: { like: PREFIX } }, overrideAccess: true })
  await payload.delete({ collection: 'events', where: { slug: { like: PREFIX } }, overrideAccess: true })
  await payload.delete({ collection: 'users', where: { email: { like: PREFIX } } })
}

describe('ticket waitlist', () => {
  beforeAll(async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_int_placeholder'
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_int_waitlist'
    payload = await getPayload({ config: await config })
    studioA = await ensureTenant(payload, { name: 'Int Studio A', slug: 'int-studio-a' })
    studioB = await ensureTenant(payload, { name: 'Int Studio B', slug: 'int-studio-b' })
    await cleanup()
    managerA = await makeUser('manager-a', studioA, ['production-manager'])
    managerB = await makeUser('manager-b', studioB, ['production-manager'])
    event = await payload.create({
      collection: 'events',
      data: {
        tenant: studioA.id,
        title: `${PREFIX}Masterclass`,
        slug: `${PREFIX}masterclass`,
        startsAt: new Date(NOW + 30 * DAY).toISOString(),
        timeZone: 'Europe/Lisbon',
        published: true,
        listed: true,
      } as never,
      overrideAccess: true,
    })
  })

  afterAll(async () => {
    await cleanup()
    process.env.STRIPE_SECRET_KEY = originalSecrets.key
    process.env.STRIPE_WEBHOOK_SECRET = originalSecrets.webhook
  })

  it('opens only once a ticket is sold out, and once per person', async () => {
    const ticketType = await makeTicketType()
    expect(await join(ticketType)).toMatchObject({ reason: 'closed' })
    await fill(ticketType)
    const email = `${PREFIX}twice@example.com`
    const token = tokenOf(await join(ticketType, { email }))
    expect(isShareToken(token)).toBe(true)
    expect(await join(ticketType, { email })).toMatchObject({ reason: 'already' })
    // More places than one order allows are refused, as when registering.
    expect(await join(ticketType, { quantity: '5' })).toMatchObject({ errors: { quantity: 'invalid' } })
    // A ticket of another studio is never joined from this studio's site.
    expect(await join(ticketType, {}, studioB)).toMatchObject({ reason: 'closed' })
    expect((await entryOf(token)).status).toBe('waiting')
  })

  it('offers freed places strictly in the order people joined, and keeps them from everyone else', async () => {
    const ticketType = await makeTicketType()
    const taken = await fill(ticketType)
    const first = tokenOf(await join(ticketType, { quantity: '2' }))
    const second = tokenOf(await join(ticketType, { quantity: '1' }))
    expect(await waitlistPosition(payload, await entryOf(second))).toBe(2)

    // One place frees up: the first person needs two, so nobody jumps the queue.
    await cancel(taken[0]!)
    expect((await entryOf(first)).status).toBe('waiting')
    expect((await entryOf(second)).status).toBe('waiting')
    // While people wait, the ticket stays sold out to the public.
    expect(await register(ticketType)).toMatchObject({ reason: 'soldOut' })
    const [offer] = await ticketOffers(payload, event, 'en')
    expect(offer).toMatchObject({ state: 'soldOut', waiting: 2, left: 1 })

    // A second place frees up: both go to the first person and are held for a day.
    await cancel(taken[1]!)
    const offered = await entryOf(first)
    expect(offered.status).toBe('offered')
    expect(new Date(offered.offerExpiresAt!).getTime()).toBeGreaterThan(Date.now() + WAITLIST_OFFER_MS - 60_000)
    expect((await entryOf(second)).status).toBe('waiting')
    expect(await placesTaken(payload, ticketType.id)).toBe(3)
    expect(await register(ticketType)).toMatchObject({ reason: 'soldOut' })
    expect(await waitlistPosition(payload, await entryOf(second))).toBe(1)
  })

  it('lets the person offered places take them with their link, once', async () => {
    const ticketType = await makeTicketType()
    const taken = await fill(ticketType)
    const token = tokenOf(await join(ticketType, { quantity: '1', name: 'Ana Costa' }))
    // Not offered yet: nothing to take.
    expect(await claim(token)).toMatchObject({ reason: 'closed' })
    await cancel(taken[0]!)

    // From another studio's site the link is unknown.
    expect(await findWaitlistEntry(payload, studioB.id, token)).toBeNull()
    expect(await claim(token, studioB)).toMatchObject({ reason: 'closed' })

    const result = await claim(token)
    expect(result).toMatchObject({ status: 'registered', token: expect.any(String) })
    const entry = await entryOf(token)
    expect(entry.status).toBe('claimed')
    const registration = await payload.findByID({ collection: 'registrations', id: idOf(entry.registration)!, overrideAccess: true })
    expect(registration).toMatchObject({ name: 'Ana Costa', quantity: 1, status: 'confirmed' })
    expect(await placesTaken(payload, ticketType.id)).toBe(3)
    expect(await claim(token)).toMatchObject({ reason: 'closed' })
  })

  it('sends someone claiming a paid ticket to Stripe for its price', async () => {
    const ticketType = await makeTicketType({ capacity: 1, price: 3000, currency: 'eur' })
    const [only] = await fill(ticketType)
    const token = tokenOf(await join(ticketType, { quantity: '2' }))
    await payload.update({ collection: 'ticket-types', id: ticketType.id, data: { capacity: 3 }, overrideAccess: true })
    // More places: offered to the person waiting, as long as they fit.
    expect((await entryOf(token)).status).toBe('offered')
    expect(only).toBeDefined()

    const result = await claim(token)
    expect(result).toMatchObject({ status: 'checkout', url: expect.stringMatching(/^https:\/\/checkout\.stripe\.test\//) })
    expect(checkouts[checkouts.length - 1]).toMatchObject({ unitAmount: 3000, quantity: 2 })
    const entry = await entryOf(token)
    expect(entry.status).toBe('claimed')
    const registration = await payload.findByID({ collection: 'registrations', id: idOf(entry.registration)!, overrideAccess: true })
    expect(registration).toMatchObject({ status: 'pending', amount: 6000 })
  })

  it('passes an offer not taken in time, or given up, to the next person', async () => {
    const ticketType = await makeTicketType()
    const taken = await fill(ticketType)
    const first = tokenOf(await join(ticketType))
    const second = tokenOf(await join(ticketType))
    const third = tokenOf(await join(ticketType))
    await cancel(taken[0]!)
    expect((await entryOf(first)).status).toBe('offered')

    // A day later the first offer has run out; the place goes to the second person.
    const later = Date.now() + WAITLIST_OFFER_MS + 60_000
    await refreshWaitlist(payload, ticketType.id, { now: later })
    expect((await entryOf(first)).status).toBe('expired')
    expect((await entryOf(second)).status).toBe('offered')
    expect(await claim(first, studioA, later)).toMatchObject({ reason: 'closed' })

    // The second person leaves with their link; the third is offered the place.
    expect(await leaveWaitlist({ payload, tenantId: studioA.id, token: second })).toBe(true)
    expect((await entryOf(second)).status).toBe('left')
    expect((await entryOf(third)).status).toBe('offered')
    expect(await leaveWaitlist({ payload, tenantId: studioA.id, token: second })).toBe(false)
    expect(await leaveWaitlist({ payload, tenantId: studioB.id, token: third })).toBe(false)
  })

  it('offers nothing once the ticket is off sale', async () => {
    const ticketType = await makeTicketType()
    const taken = await fill(ticketType)
    const token = tokenOf(await join(ticketType))
    await payload.update({ collection: 'ticket-types', id: ticketType.id, data: { onSale: false }, overrideAccess: true })
    await cancel(taken[0]!)
    expect((await entryOf(token)).status).toBe('waiting')
    // Back on sale: the freed place is offered.
    await payload.update({ collection: 'ticket-types', id: ticketType.id, data: { onSale: true }, overrideAccess: true })
    expect((await entryOf(token)).status).toBe('offered')
  })

  it("keeps each studio's waitlist to its own staff, who can only take people off it", async () => {
    const ticketType = await makeTicketType()
    await fill(ticketType)
    const token = tokenOf(await join(ticketType))
    const entry = await entryOf(token)
    expect(idOf(entry.tenant)).toBe(studioA.id)
    expect(idOf(entry.event)).toBe(event.id)

    const visible = (user?: User) =>
      payload
        .find({ collection: 'waitlist-entries', where: { id: { equals: entry.id } }, user, overrideAccess: false })
        .then((r) => r.docs.length)
        .catch(() => 0)
    expect(await visible(managerA)).toBe(1)
    expect(await visible(managerB)).toBe(0)
    expect(await visible(undefined)).toBe(0)

    // Nobody joins through the API, and another studio's staff change nothing.
    await expect(
      payload.create({
        collection: 'waitlist-entries',
        data: { ticketType: ticketType.id, name: 'Sneaky', email: 'sneaky@example.com', quantity: 1 } as never,
        user: managerA,
        overrideAccess: false,
      }),
    ).rejects.toThrow()
    await expect(
      payload.update({ collection: 'waitlist-entries', id: entry.id, data: { status: 'removed' }, user: managerB, overrideAccess: false }),
    ).rejects.toThrow()
    await expect(
      payload.delete({ collection: 'waitlist-entries', id: entry.id, user: managerB, overrideAccess: false }),
    ).rejects.toThrow()
    // Staff cannot hand out places by hand; offers follow the queue.
    await expect(
      payload.update({ collection: 'waitlist-entries', id: entry.id, data: { status: 'offered' }, user: managerA, overrideAccess: false }),
    ).rejects.toThrow(/only remove/)

    const asManager = await payload.findByID({ collection: 'waitlist-entries', id: entry.id, user: managerA, overrideAccess: false })
    expect(isShareToken(asManager.claimToken)).toBe(true)
    expect(asManager).not.toHaveProperty('senderKey')
    const removed = await payload.update({
      collection: 'waitlist-entries',
      id: entry.id,
      data: { status: 'removed' },
      user: managerA,
      overrideAccess: false,
    })
    expect(removed.status).toBe('removed')
    expect(removed.claimToken).toBe(asManager.claimToken)
  })

  it('lets only one of two claims at once take the offered places', async () => {
    const ticketType = await makeTicketType({ capacity: 2 })
    const taken = await fill(ticketType)
    // The first person waits for one place; the second needs two, so the spare place stays unoffered.
    const token = tokenOf(await join(ticketType, { quantity: '1' }))
    await join(ticketType, { quantity: '2' })
    await cancel(taken[0]!)
    await cancel(taken[1]!)
    expect((await entryOf(token)).status).toBe('offered')

    const results = await Promise.all([claim(token), claim(token)])
    expect(results.filter((r) => r.status === 'registered')).toHaveLength(1)
    expect(results.filter((r) => r.status === 'error')).toHaveLength(1)
    const { totalDocs } = await payload.count({
      collection: 'registrations',
      where: { and: [{ ticketType: { equals: ticketType.id } }, { status: { equals: 'confirmed' } }] },
      overrideAccess: true,
    })
    expect(totalDocs).toBe(1)
  })

  it('keeps everything but the status out of staff hands', async () => {
    const ticketType = await makeTicketType()
    const taken = await fill(ticketType)
    const token = tokenOf(await join(ticketType))
    await cancel(taken[0]!)
    const offered = await entryOf(token)
    const saved = await payload.update({
      collection: 'waitlist-entries',
      id: offered.id,
      data: { offerExpiresAt: '3000-01-01T00:00:00.000Z', email: 'someone-else@example.com', quantity: 4 },
      user: managerA,
      overrideAccess: false,
    })
    expect(saved).toMatchObject({ offerExpiresAt: offered.offerExpiresAt, email: offered.email, quantity: offered.quantity })
  })
})
