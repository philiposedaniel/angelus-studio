import { getPayload, type Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { issueFormToken, MIN_FILL_MS } from '@/lib/inquiries'
import { cancelTicket, giveBackTicketPlaces } from '@/lib/tickets'
import { joinWaitlist } from '@/lib/waitlist'
import config from '@/payload.config'
import type { Event, Registration, Tenant, TicketType } from '@/payload-types'

import { ensureTenant } from '../helpers/seedTenant'

/** A ticket's holder cancels their own free registration, or gives back some places, with its link; the places go to the waitlist. */

const PREFIX = 'int-tcancel-'
const NOW = Date.now()
const DAY = 86_400_000
const originalSecret = process.env.STRIPE_SECRET_KEY

let payload: Payload
let studioA: Tenant
let studioB: Tenant
let upcoming: Event
let past: Event
let counter = 0

const makeEvent = (slug: string, startsAt: number) =>
  payload.create({
    collection: 'events',
    data: {
      tenant: studioA.id,
      title: `${PREFIX}${slug}`,
      slug: `${PREFIX}${slug}`,
      startsAt: new Date(startsAt).toISOString(),
      timeZone: 'Europe/Lisbon',
      published: true,
    },
    overrideAccess: true,
  })

const makeTicketType = (event: Event, extra: Record<string, unknown> = {}) =>
  payload.create({
    collection: 'ticket-types',
    data: { event: event.id, name: `${PREFIX}Entry`, capacity: 1, ...extra } as never,
    overrideAccess: true,
  })

const register = (ticketType: TicketType, extra: Record<string, unknown> = {}) =>
  payload.create({
    collection: 'registrations',
    data: { ticketType: ticketType.id, name: 'Ana', email: `${PREFIX}${++counter}@example.com`, quantity: 1, ...extra } as never,
    overrideAccess: true,
  })

const statusOf = async (registration: Registration) =>
  (await payload.findByID({ collection: 'registrations', id: registration.id, overrideAccess: true })).status

const cancel = (registration: Registration, tenant = studioA, now = NOW) =>
  cancelTicket({ payload, tenantId: tenant.id, token: registration.ticketToken, now })

const cleanup = async () => {
  await payload.delete({ collection: 'events', where: { slug: { like: PREFIX } }, overrideAccess: true })
}

describe('cancelling a free ticket with its link', () => {
  beforeAll(async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_int_placeholder'
    payload = await getPayload({ config: await config })
    studioA = await ensureTenant(payload, { name: 'Int Ticket Cancel A', slug: 'int-tcancel-a' })
    studioB = await ensureTenant(payload, { name: 'Int Ticket Cancel B', slug: 'int-tcancel-b' })
    await cleanup()
    upcoming = await makeEvent('upcoming', NOW + 30 * DAY)
    past = await makeEvent('past', NOW - DAY)
  })

  afterAll(async () => {
    await cleanup()
    process.env.STRIPE_SECRET_KEY = originalSecret
  })

  it('cancels a confirmed free registration and offers its place to the waitlist', async () => {
    const ticketType = await makeTicketType(upcoming)
    const ana = await register(ticketType)
    const form = new FormData()
    for (const [key, value] of Object.entries({
      formToken: issueFormToken(studioA.id, NOW - MIN_FILL_MS - 1000),
      ticketType: String(ticketType.id),
      quantity: '1',
      name: 'Rui',
      email: `${PREFIX}rui@example.com`,
      consent: 'on',
    }))
      form.set(key, value)
    const joined = await joinWaitlist({ payload, tenantId: studioA.id, eventId: upcoming.id, locale: 'en', form, address: '203.0.113.9' })
    expect(joined.status).toBe('joined')

    expect(await cancel(ana)).toEqual({ status: 'cancelled' })
    expect(await statusOf(ana)).toBe('cancelled')
    const entry = (
      await payload.find({ collection: 'waitlist-entries', where: { email: { equals: `${PREFIX}rui@example.com` } }, overrideAccess: true })
    ).docs[0]!
    expect(entry.status).toBe('offered')
    // Once cancelled, the link cannot cancel again.
    expect(await cancel(ana)).toEqual({ status: 'error', reason: 'closed' })
  })

  it('leaves paid, checked-in and started registrations to the studio', async () => {
    const paid = await register(await makeTicketType(upcoming, { price: 1500, currency: 'eur', capacity: 5 }), { status: 'confirmed' })
    expect(paid.amount).toBeGreaterThan(0)
    const arrived = await register(await makeTicketType(upcoming, { capacity: 5 }), { checkedInCount: 1 })
    const late = await register(await makeTicketType(past, { capacity: 5 }))
    for (const registration of [paid, arrived, late]) {
      expect(await cancel(registration)).toEqual({ status: 'error', reason: 'closed' })
      expect(await statusOf(registration)).toBe('confirmed')
    }
  })

  it('gives back some places of a free registration and offers them to the waitlist', async () => {
    const ticketType = await makeTicketType(upcoming, { capacity: 3, maxPerOrder: 4 })
    const party = await register(ticketType, { quantity: 3 })
    const form = new FormData()
    for (const [key, value] of Object.entries({
      formToken: issueFormToken(studioA.id, NOW - MIN_FILL_MS - 1000),
      ticketType: String(ticketType.id),
      quantity: '1',
      name: 'Bea',
      email: `${PREFIX}bea@example.com`,
      consent: 'on',
    }))
      form.set(key, value)
    expect((await joinWaitlist({ payload, tenantId: studioA.id, eventId: upcoming.id, locale: 'en', form, address: '203.0.113.10' })).status).toBe('joined')

    const giveBack = (keep: string, tenant = studioA) =>
      giveBackTicketPlaces({ payload, tenantId: tenant.id, token: party.ticketToken, keep, now: NOW })
    for (const keep of ['0', '3', '4', 'x', '', '2147483648']) expect(await giveBack(keep)).toEqual({ status: 'error', reason: 'invalid' })
    expect(await giveBack('2', studioB)).toEqual({ status: 'error', reason: 'closed' })
    expect(await giveBack('2')).toEqual({ status: 'reduced', quantity: 2 })
    const after = await payload.findByID({ collection: 'registrations', id: party.id, overrideAccess: true })
    expect(after.quantity).toBe(2)
    expect(after.status).toBe('confirmed')
    const entry = (
      await payload.find({ collection: 'waitlist-entries', where: { email: { equals: `${PREFIX}bea@example.com` } }, overrideAccess: true })
    ).docs[0]!
    expect(entry.status).toBe('offered')
    // A single place left can only be cancelled.
    expect(await giveBack('1')).toEqual({ status: 'reduced', quantity: 1 })
    expect(await giveBack('1')).toEqual({ status: 'error', reason: 'invalid' })
  })

  it('does not change places on paid, checked-in or started registrations', async () => {
    const paid = await register(await makeTicketType(upcoming, { price: 1500, currency: 'eur', capacity: 5, maxPerOrder: 4 }), {
      quantity: 2,
    })
    const arrived = await register(await makeTicketType(upcoming, { capacity: 5, maxPerOrder: 4 }), { quantity: 2, checkedInCount: 1 })
    const late = await register(await makeTicketType(past, { capacity: 5, maxPerOrder: 4 }), { quantity: 2 })
    for (const registration of [paid, arrived, late]) {
      expect(await giveBackTicketPlaces({ payload, tenantId: studioA.id, token: registration.ticketToken, keep: '1', now: NOW })).toEqual({
        status: 'error',
        reason: 'closed',
      })
      expect((await payload.findByID({ collection: 'registrations', id: registration.id, overrideAccess: true })).quantity).toBe(2)
    }
  })

  it("does nothing on another studio's site or with a made-up link", async () => {
    const ana = await register(await makeTicketType(upcoming, { capacity: 5 }))
    expect(await cancel(ana, studioB)).toEqual({ status: 'error', reason: 'closed' })
    expect(await cancelTicket({ payload, tenantId: studioA.id, token: 'not-a-token' })).toEqual({ status: 'error', reason: 'closed' })
    expect(await cancelTicket({ payload, tenantId: studioA.id, token: 'a'.repeat(43) })).toEqual({ status: 'error', reason: 'closed' })
    expect(await statusOf(ana)).toBe('confirmed')
  })
})
