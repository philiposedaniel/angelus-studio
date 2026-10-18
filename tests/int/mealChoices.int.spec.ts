import { createLocalReq, getPayload, type Payload, type PayloadRequest } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { exportGuestList } from '@/lib/guestListEndpoints'
import { eventMealCounts, eventRsvpSummary, submitRsvp, summarizeMeals } from '@/lib/rsvp'
import config from '@/payload.config'
import type { Event, EventGuest, Tenant, User } from '@/payload-types'

import { ensureTenant } from '../helpers/seedTenant'

/** Guests name the people they bring and pick a meal for each; staff see the counts. */

const PREFIX = 'int-meal-'
const password = 'int-Password-1'

let payload: Payload
let studioA: Tenant
let studioB: Tenant
let managerA: User
let managerB: User
let eventA: Event
let eventB: Event
let fish: string
let meat: string
let veg: string
let foreignMeal: string

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

const makeEvent = (tenant: Tenant, slug: string, meals: string[]) =>
  payload.create({
    collection: 'events',
    data: {
      tenant: tenant.id,
      title: `${PREFIX}${slug}`,
      slug: `${PREFIX}${slug}`,
      startsAt: '2027-06-12T15:00:00.000Z',
      timeZone: 'Europe/Lisbon',
      published: true,
      mealOptions: meals.map((label) => ({ label })),
    } as never,
    overrideAccess: true,
  })

const makeGuest = (event: Event, name: string, partySize = 3) =>
  payload.create({
    collection: 'event-guests',
    data: { event: event.id, name: `${PREFIX}${name}`, partySize, language: 'en', rsvpStatus: 'pending' } as never,
    overrideAccess: true,
  })

const reply = (tenant: Tenant, guest: EventGuest, values: Record<string, string>) => {
  const form = new FormData()
  form.set('token', guest.inviteToken!)
  for (const [key, value] of Object.entries(values)) form.set(key, value)
  return submitRsvp({ payload, tenantId: tenant.id, form })
}

const read = (guest: EventGuest) => payload.findByID({ collection: 'event-guests', id: guest.id, depth: 0, overrideAccess: true })

const cleanup = async () => {
  await payload.delete({ collection: 'events', where: { slug: { like: PREFIX } }, overrideAccess: true })
  await payload.delete({ collection: 'users', where: { email: { like: PREFIX } } })
}

describe('meal choices and names on replies', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    studioA = await ensureTenant(payload, { name: 'Int Studio A', slug: 'int-studio-a' })
    studioB = await ensureTenant(payload, { name: 'Int Studio B', slug: 'int-studio-b' })
    await cleanup()
    managerA = await makeUser('manager-a', studioA, ['production-manager'])
    managerB = await makeUser('manager-b', studioB, ['production-manager'])
    eventA = await makeEvent(studioA, 'dinner-a', ['Fish', 'Meat', 'Vegetarian'])
    eventB = await makeEvent(studioB, 'dinner-b', ['Lobster'])
    ;[fish, meat, veg] = eventA.mealOptions!.map((option) => option.id!) as [string, string, string]
    foreignMeal = eventB.mealOptions![0]!.id!
  })

  afterAll(cleanup)

  it('saves who is coming with a meal each, the guest first by the name on the invitation', async () => {
    const guest = await makeGuest(eventA, 'Maria Silva')
    const result = await reply(studioA, guest, {
      response: 'attending',
      attendingCount: '3',
      // The guest's own name is never taken from the form.
      'party.0.name': 'Someone else',
      'party.0.meal': fish,
      'party.1.name': 'João Silva',
      'party.1.meal': veg,
      'party.2.meal': fish,
    })
    expect(result).toEqual({ status: 'saved', response: 'attending' })
    const saved = await read(guest)
    expect(saved.party?.map(({ name, meal }) => ({ name, meal }))).toEqual([
      { name: `${PREFIX}Maria Silva`, meal: fish },
      { name: 'João Silva', meal: veg },
      { name: null, meal: fish },
    ])

    // Changing the answer to fewer people keeps only those people; declining clears them.
    await reply(studioA, guest, { response: 'attending', attendingCount: '1', 'party.0.meal': meat, 'party.1.meal': fish })
    expect((await read(guest)).party?.map((person) => person.meal)).toEqual([meat])
    await reply(studioA, guest, { response: 'declined' })
    expect((await read(guest)).party).toEqual([])
  })

  it('asks for a meal for each person, and only one this event offers', async () => {
    const guest = await makeGuest(eventA, 'Ana Costa', 2)
    const missing = await reply(studioA, guest, { response: 'attending', attendingCount: '2', 'party.0.meal': fish })
    expect(missing).toEqual({ status: 'error', errors: { 'party.1.meal': 'chooseMeal' } })
    // Another studio's meal, or a made-up one, is not a choice here.
    const foreign = await reply(studioA, guest, {
      response: 'attending',
      attendingCount: '2',
      'party.0.meal': foreignMeal,
      'party.1.meal': 'not-a-meal',
    })
    expect(foreign).toEqual({ status: 'error', errors: { 'party.0.meal': 'chooseMeal', 'party.1.meal': 'chooseMeal' } })
    const tooLong = await reply(studioA, guest, {
      response: 'attending',
      attendingCount: '2',
      'party.0.meal': fish,
      'party.1.name': 'x'.repeat(121),
      'party.1.meal': fish,
    })
    expect(tooLong).toEqual({ status: 'error', errors: { 'party.1.name': 'tooLong' } })
    expect((await read(guest)).rsvpStatus).toBe('pending')
  })

  it('asks only for names when the event offers no meals, and nothing for a party of one', async () => {
    const plain = await makeEvent(studioA, 'plain', [])
    const couple = await makeGuest(plain, 'Rui Dias', 2)
    expect(await reply(studioA, couple, { response: 'attending', attendingCount: '2', 'party.1.name': 'Inês Dias' })).toMatchObject({
      status: 'saved',
    })
    expect((await read(couple)).party?.map(({ name, meal }) => ({ name, meal }))).toEqual([
      { name: `${PREFIX}Rui Dias`, meal: null },
      { name: 'Inês Dias', meal: null },
    ])
    const single = await makeGuest(plain, 'Solo', 1)
    await reply(studioA, single, { response: 'attending' })
    expect((await read(single)).party).toEqual([])
  })

  it('adds up the meals of the people coming, in the database', async () => {
    const event = await makeEvent(studioA, 'counts', ['Fish', 'Meat'])
    const [f, m] = event.mealOptions!.map((option) => option.id!) as [string, string]
    const one = await makeGuest(event, 'One', 3)
    const two = await makeGuest(event, 'Two', 2)
    const three = await makeGuest(event, 'Three', 2)
    await reply(studioA, one, { response: 'attending', attendingCount: '3', 'party.0.meal': f, 'party.1.meal': f, 'party.2.meal': m })
    await reply(studioA, two, { response: 'attending', attendingCount: '2', 'party.0.meal': m, 'party.1.meal': m })
    await reply(studioA, three, { response: 'declined' })
    // Staff record a phone answer without meals yet.
    await payload.update({ collection: 'event-guests', id: three.id, data: { rsvpStatus: 'attending', attendingCount: 2 }, overrideAccess: true })

    const summary = await eventRsvpSummary(payload, event.id)
    const meals = summarizeMeals(event, await eventMealCounts(payload, event.id), summary.headcount)
    expect(meals).toEqual({
      meals: [
        { id: f, label: 'Fish', count: 2 },
        { id: m, label: 'Meat', count: 3 },
      ],
      notChosen: 2,
    })

    // A meal taken off the menu counts as not chosen, and is cleared the next time the guest changes.
    const updated = await payload.update({
      collection: 'events',
      id: event.id,
      data: { mealOptions: [{ id: f, label: 'Fish' }] },
      overrideAccess: true,
    })
    const after = summarizeMeals(updated, await eventMealCounts(payload, event.id), summary.headcount)
    expect(after).toEqual({ meals: [{ id: f, label: 'Fish', count: 2 }], notChosen: 5 })
    await payload.update({ collection: 'event-guests', id: two.id, data: { group: 'Family' }, overrideAccess: true })
    expect((await read(two)).party?.map((person) => person.meal)).toEqual([null, null])
  })

  it('keeps the people and meals within the studio, and within the seats', async () => {
    const guest = await makeGuest(eventA, 'Private', 2)
    await reply(studioA, guest, { response: 'attending', attendingCount: '2', 'party.0.meal': fish, 'party.1.name': 'Plus One', 'party.1.meal': meat })

    // Another studio's manager cannot see or change them.
    const seen = await payload.find({
      collection: 'event-guests',
      where: { id: { equals: guest.id } },
      user: managerB,
      overrideAccess: false,
    })
    expect(seen.docs).toHaveLength(0)
    await expect(
      payload.update({
        collection: 'event-guests',
        id: guest.id,
        data: { party: [{ name: 'Intruder', meal: foreignMeal }] },
        user: managerB,
        overrideAccess: false,
      }),
    ).rejects.toThrow()
    // A reply sent through another studio's site is refused too.
    expect(await reply(studioB, guest, { response: 'attending', attendingCount: '1', 'party.0.meal': foreignMeal })).toEqual({
      status: 'error',
      reason: 'failed',
    })

    // The studio's own staff can edit them, but not name more people than are coming, and a
    // meal from another event does not stick.
    await expect(
      payload.update({
        collection: 'event-guests',
        id: guest.id,
        data: { party: [{ name: 'A' }, { name: 'B' }, { name: 'C' }] },
        user: managerA,
        overrideAccess: false,
      }),
    ).rejects.toThrow(/More people are named/)
    const edited = await payload.update({
      collection: 'event-guests',
      id: guest.id,
      data: { party: [{ name: `${PREFIX}Private`, meal: fish }, { name: 'Plus One', meal: foreignMeal }] },
      user: managerA,
      overrideAccess: false,
    })
    expect(edited.party?.map((person) => person.meal)).toEqual([fish, null])
  })

  it('lists who is coming and their meals in the guest list download', async () => {
    const guest = await makeGuest(eventA, 'Csv Guest', 2)
    await reply(studioA, guest, { response: 'attending', attendingCount: '2', 'party.0.meal': veg, 'party.1.meal': meat })
    const req = (await createLocalReq({ user: managerA }, payload)) as PayloadRequest
    req.user = { ...managerA, collection: 'users' } as PayloadRequest['user']
    ;(req as { searchParams: URLSearchParams }).searchParams = new URLSearchParams({ event: String(eventA.id) })
    const response = await exportGuestList(req)
    expect(response.status).toBe(200)
    const csv = await response.text()
    expect(csv).toContain('Who is coming')
    expect(csv).toContain(`${PREFIX}Csv Guest (Vegetarian), Guest 2 (Meat)`)
  })
})
