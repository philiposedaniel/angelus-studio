import { sql } from '@payloadcms/db-postgres'
import { createLocalReq, getPayload, type Payload, type PayloadRequest, type Where } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { exportAttendees } from '@/lib/attendees'
import { exportGuestList } from '@/lib/guestListEndpoints'
import { eventRsvpSummary, summarizeRsvps } from '@/lib/rsvp'
import { placesTaken, ticketOffers } from '@/lib/tickets'
import { runSql } from '@/lib/sqlSession'
import { refreshWaitlist, waitlistPosition } from '@/lib/waitlist'
import config from '@/payload.config'
import type { Event, Tenant, TicketType, User } from '@/payload-types'

import { ensureTenant } from '../helpers/seedTenant'

/**
 * Speed on a large event. The rows are written straight to the database (hooks would take
 * minutes), then the reads staff and visitors actually hit are timed against the targets in
 * docs/development.md. The targets leave room for a slow CI machine; locally each is far under.
 */

const PREFIX = 'int-large-'
const password = 'int-Password-1'
const DAY = 86_400_000
const REGISTRATIONS = 5_000
const GUESTS = 5_000
const WAITING = 2_000

/** Milliseconds each read may take on an event of the size above. */
const TARGETS = {
  placesTaken: 150,
  eventPage: 400,
  waitlistPosition: 150,
  attendeeCsv: 2_000,
  guestCsv: 2_000,
  guestPage: 300,
  rsvpSummary: 100,
  registrationSummary: 1_000,
} as const

let payload: Payload
let studio: Tenant
let manager: User
let event: Event
let ticketType: TicketType
const timings: Record<string, number> = {}

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

const request = async (user: User, query: Record<string, string>) => {
  const req = (await createLocalReq({ user }, payload)) as PayloadRequest
  req.user = { ...user, collection: 'users' } as PayloadRequest['user']
  ;(req as { searchParams: URLSearchParams }).searchParams = new URLSearchParams(query)
  return req
}

/** The best of three runs, so one hiccup on a shared machine does not fail the suite. */
const time = async <T>(name: keyof typeof TARGETS, run: () => Promise<T>): Promise<T> => {
  let best = Infinity
  let result: T | undefined
  for (let i = 0; i < 3; i++) {
    const start = performance.now()
    result = await run()
    best = Math.min(best, performance.now() - start)
  }
  timings[name] = Math.round(best)
  return result as T
}

const run = (query: ReturnType<typeof sql>) => runSql(payload, query)

const cleanup = async () => {
  await payload.delete({ collection: 'events', where: { slug: { like: PREFIX } }, overrideAccess: true })
  await payload.delete({ collection: 'users', where: { email: { like: PREFIX } } })
}

describe('a large event', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    studio = await ensureTenant(payload, { name: 'Int Studio A', slug: 'int-studio-a' })
    await cleanup()
    manager = await makeUser('manager', studio, ['production-manager'])
    event = await payload.create({
      collection: 'events',
      data: {
        tenant: studio.id,
        title: `${PREFIX}festival`,
        slug: `${PREFIX}festival`,
        startsAt: new Date(Date.now() + 30 * DAY).toISOString(),
        timeZone: 'Europe/Lisbon',
        published: true,
        listed: true,
      } as never,
      overrideAccess: true,
    })
    ticketType = await payload.create({
      collection: 'ticket-types',
      data: { event: event.id, name: `${PREFIX}Day pass`, capacity: REGISTRATIONS, maxPerOrder: 4, price: 0 } as never,
      overrideAccess: true,
    })
    const hold = new Date(Date.now() + DAY).toISOString()
    await run(sql`
      INSERT INTO registrations (tenant_id, ticket_type_id, event_id, name, email, quantity, status, language, ticket_token, hold_expires_at, amount, created_at, updated_at)
      SELECT ${studio.id}, ${ticketType.id}, ${event.id}, 'Attendee ' || n, ${PREFIX} || 'a' || n || '@example.com', 1 + n % 2,
        (CASE WHEN n % 10 = 0 THEN 'pending' WHEN n % 25 = 0 THEN 'cancelled' ELSE 'confirmed' END)::enum_registrations_status,
        'en', ${PREFIX} || 'ticket-' || ${event.id} || '-' || n, CASE WHEN n % 10 = 0 THEN ${hold}::timestamptz END, 0,
        now() - (n || ' seconds')::interval, now()
      FROM generate_series(1, ${REGISTRATIONS}) AS n`)
    await run(sql`
      INSERT INTO event_guests (tenant_id, event_id, name, email, party_size, language, rsvp_status, attending_count, invite_token, created_at, updated_at)
      SELECT ${studio.id}, ${event.id}, 'Guest ' || n, ${PREFIX} || 'g' || n || '@example.com', 1 + n % 4, 'en',
        (CASE WHEN n % 3 = 0 THEN 'attending' WHEN n % 3 = 1 THEN 'pending' ELSE 'declined' END)::enum_event_guests_rsvp_status,
        CASE WHEN n % 3 = 0 THEN 1 + n % 4 ELSE 0 END, ${PREFIX} || 'invite-' || ${event.id} || '-' || n, now(), now()
      FROM generate_series(1, ${GUESTS}) AS n`)
    await run(sql`
      INSERT INTO waitlist_entries (tenant_id, ticket_type_id, event_id, name, email, quantity, status, language, claim_token, created_at, updated_at)
      SELECT ${studio.id}, ${ticketType.id}, ${event.id}, 'Waiting ' || n, ${PREFIX} || 'w' || n || '@example.com', 1, 'waiting', 'en',
        ${PREFIX} || 'claim-' || ${event.id} || '-' || n, now() - ((${WAITING} - n) || ' seconds')::interval, now()
      FROM generate_series(1, ${WAITING}) AS n`)
    await run(sql`ANALYZE registrations; ANALYZE event_guests; ANALYZE waitlist_entries`)
  }, 120_000)

  afterAll(async () => {
    console.info(`Large event timings in ms (targets ${JSON.stringify(TARGETS)}):`, timings)
    await run(sql`DELETE FROM registrations WHERE email LIKE ${PREFIX + '%'}`)
    await run(sql`DELETE FROM event_guests WHERE email LIKE ${PREFIX + '%'}`)
    await run(sql`DELETE FROM waitlist_entries WHERE email LIKE ${PREFIX + '%'}`)
    await cleanup()
  }, 120_000)

  it('counts places taken quickly', async () => {
    const taken = await time('placesTaken', () => placesTaken(payload, ticketType.id))
    expect(taken).toBeGreaterThan(REGISTRATIONS)
    expect(timings.placesTaken).toBeLessThan(TARGETS.placesTaken)
  })

  it('shows the public event page quickly, waitlist refresh included', async () => {
    const offers = await time('eventPage', () =>
      ticketOffers(payload, event, 'en', Date.now(), (id, now) => refreshWaitlist(payload, id, { now })),
    )
    expect(offers[0]).toMatchObject({ waiting: WAITING })
    expect(timings.eventPage).toBeLessThan(TARGETS.eventPage)
  })

  it("shows someone's place in the waitlist quickly", async () => {
    const position = await time('waitlistPosition', () =>
      waitlistPosition(payload, { ticketType: ticketType.id, createdAt: new Date().toISOString() }),
    )
    expect(position).toBeGreaterThanOrEqual(WAITING)
    expect(timings.waitlistPosition).toBeLessThan(TARGETS.waitlistPosition)
  })

  it('downloads the attendee list quickly', async () => {
    const response = await time('attendeeCsv', async () => exportAttendees(await request(manager, { event: String(event.id) })))
    expect(response.status).toBe(200)
    expect((await response.text()).split('\n').length).toBeGreaterThan(REGISTRATIONS)
    expect(timings.attendeeCsv).toBeLessThan(TARGETS.attendeeCsv)
  })

  it('downloads the guest list quickly', async () => {
    const response = await time('guestCsv', async () => exportGuestList(await request(manager, { event: String(event.id) })))
    expect(response.status).toBe(200)
    expect((await response.text()).split('\n').length).toBeGreaterThan(GUESTS)
    expect(timings.guestCsv).toBeLessThan(TARGETS.guestCsv)
  })

  it("shows a page of the organizer's guest list, and a search, quickly", async () => {
    const page = (where: Where) =>
      payload.find({
        collection: 'event-guests',
        where: { and: [{ event: { equals: event.id } }, where] },
        sort: 'name',
        limit: 100,
        page: 20,
        depth: 0,
        user: manager,
        overrideAccess: false,
      })
    const { docs, totalDocs } = await time('guestPage', () => page({}))
    expect(docs).toHaveLength(100)
    expect(totalDocs).toBe(GUESTS)
    const found = await page({ or: [{ name: { like: 'Guest 4999' } }, { email: { like: 'Guest 4999' } }] })
    expect(found.totalDocs).toBe(1)
    expect(timings.guestPage).toBeLessThan(TARGETS.guestPage)
  })

  it('adds up the headcount in the database, matching the full list', async () => {
    const summary = await time('rsvpSummary', () => eventRsvpSummary(payload, event.id))
    const { docs } = await payload.find({
      collection: 'event-guests',
      where: { event: { equals: event.id } },
      pagination: false,
      depth: 0,
      overrideAccess: true,
    })
    expect(summary).toEqual(summarizeRsvps(docs))
    expect(summary.invitations).toBe(GUESTS)
    expect(timings.rsvpSummary).toBeLessThan(TARGETS.rsvpSummary)
  })

  it("reads the event's registration summary quickly", async () => {
    const { docs } = await time('registrationSummary', () =>
      payload.find({
        collection: 'registrations',
        where: { event: { equals: event.id } },
        select: { ticketType: true, quantity: true, status: true, checkedInCount: true, holdExpiresAt: true },
        pagination: false,
        depth: 0,
        user: manager,
        overrideAccess: false,
      }),
    )
    expect(docs).toHaveLength(REGISTRATIONS)
    expect(timings.registrationSummary).toBeLessThan(TARGETS.registrationSummary)
  })
})
