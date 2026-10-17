import { getPayload, type Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { idOf } from '@/lib/ids'
import { issueFormToken, MIN_FILL_MS } from '@/lib/inquiries'
import { createRegistration, submitRegistration, type TicketCheckout } from '@/lib/tickets'
import config from '@/payload.config'
import type { Event, PromoCode, Tenant, TicketType, User } from '@/payload-types'

import { ensureTenant } from '../helpers/seedTenant'

const PREFIX = 'int-promo-'
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
let otherEvent: Event
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

const makeEvent = (slug: string) =>
  payload.create({
    collection: 'events',
    data: {
      tenant: studioA.id,
      title: `${PREFIX}${slug}`,
      slug: `${PREFIX}${slug}`,
      startsAt: new Date(NOW + 30 * DAY).toISOString(),
      timeZone: 'Europe/Lisbon',
      published: true,
      listed: true,
    } as never,
    overrideAccess: true,
  })

const makeTicketType = (extra: Record<string, unknown> = {}, on = event) =>
  payload.create({
    collection: 'ticket-types',
    data: { event: on.id, name: `${PREFIX}Gala`, capacity: 50, maxPerOrder: 5, price: 2500, currency: 'eur', ...extra } as never,
    overrideAccess: true,
  })

const makePromo = (code: string, extra: Record<string, unknown> = {}): Promise<PromoCode> =>
  payload.create({
    collection: 'promo-codes',
    data: { event: event.id, code, discountType: 'percent', percentOff: 10, ...extra } as never,
    overrideAccess: true,
  })

const register = (ticketType: TicketType, promoCode: string, quantity = 2) => {
  const form = new FormData()
  const values: Record<string, string> = {
    formToken: issueFormToken(studioA.id, NOW - MIN_FILL_MS - 1000),
    ticketType: String(ticketType.id),
    quantity: String(quantity),
    name: 'Maria Silva',
    email: `${PREFIX}buyer${++counter}@example.com`,
    consent: 'on',
    promoCode,
  }
  for (const [key, value] of Object.entries(values)) form.set(key, value)
  return submitRegistration({
    payload,
    tenantId: studioA.id,
    eventId: event.id,
    locale: 'en',
    form,
    address: `192.0.2.${++counter % 250}`,
    origin: 'https://studio.test',
    createCheckout: fakeCheckout,
  })
}

const lastRegistration = async () =>
  payload.findByID({
    collection: 'registrations',
    id: Number(checkouts[checkouts.length - 1]!.metadata.registrationId),
    overrideAccess: true,
  })

const cleanup = async () => {
  await payload.delete({ collection: 'payments', where: { stripeSessionId: { like: PREFIX } }, overrideAccess: true })
  await payload.delete({ collection: 'events', where: { slug: { like: PREFIX } }, overrideAccess: true })
  await payload.delete({ collection: 'users', where: { email: { like: PREFIX } } })
}

describe('promo codes', () => {
  beforeAll(async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_int_placeholder'
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_int_promo'
    payload = await getPayload({ config: await config })
    studioA = await ensureTenant(payload, { name: 'Int Studio A', slug: 'int-studio-a' })
    studioB = await ensureTenant(payload, { name: 'Int Studio B', slug: 'int-studio-b' })
    await cleanup()
    managerA = await makeUser('manager-a', studioA, ['production-manager'])
    managerB = await makeUser('manager-b', studioB, ['production-manager'])
    event = await makeEvent('gala')
    otherEvent = await makeEvent('other')
  })

  afterAll(async () => {
    await cleanup()
    process.env.STRIPE_SECRET_KEY = originalSecrets.key
    process.env.STRIPE_WEBHOOK_SECRET = originalSecrets.webhook
  })

  it("keeps each studio's codes to its own staff, one code per event", async () => {
    const promo = await payload.create({
      collection: 'promo-codes',
      data: { event: event.id, code: 'staff10', discountType: 'percent', percentOff: 10 } as never,
      user: managerA,
      overrideAccess: false,
    })
    expect(promo.code).toBe('STAFF10')
    expect(idOf(promo.tenant)).toBe(studioA.id)

    const visible = (user?: User) =>
      payload
        .find({ collection: 'promo-codes', where: { id: { equals: promo.id } }, user, overrideAccess: false })
        .then((r) => r.docs.length)
        .catch(() => 0)
    expect(await visible(managerA)).toBe(1)
    expect(await visible(managerB)).toBe(0)
    expect(await visible(undefined)).toBe(0)
    await expect(
      payload.create({
        collection: 'promo-codes',
        data: { event: event.id, code: 'SNEAKY', discountType: 'percent', percentOff: 100, tenant: studioB.id } as never,
        user: managerB,
        overrideAccess: false,
      }),
    ).rejects.toThrow()
    await expect(
      payload.update({ collection: 'promo-codes', id: promo.id, data: { percentOff: 100 }, user: managerB, overrideAccess: false }),
    ).rejects.toThrow()

    await expect(makePromo('Staff10')).rejects.toThrow(/already has that code/)
    // The same code can exist on another event.
    await expect(
      payload.create({
        collection: 'promo-codes',
        data: { event: otherEvent.id, code: 'STAFF10', discountType: 'percent', percentOff: 10 } as never,
        overrideAccess: true,
      }),
    ).resolves.toBeTruthy()
    // A code can only be kept to its own event's tickets.
    const elsewhere = await makeTicketType({}, otherEvent)
    await expect(makePromo('WRONGTIX', { ticketTypes: [elsewhere.id] })).rejects.toThrow(/this event only/)
  })

  it('takes a percentage off and charges exactly the reduced total', async () => {
    const ticketType = await makeTicketType()
    await makePromo('EARLY10', { percentOff: 10 })
    const result = await register(ticketType, ' early10 ')
    expect(result).toMatchObject({ status: 'checkout' })
    expect(checkouts[checkouts.length - 1]).toMatchObject({ unitAmount: 4500, quantity: 1, currency: 'eur' })
    const registration = await lastRegistration()
    expect(registration).toMatchObject({ amount: 4500, discount: 500, status: 'pending' })
    const payment = (
      await payload.find({ collection: 'payments', where: { registration: { equals: registration.id } }, overrideAccess: true })
    ).docs[0]!
    expect(payment.amount).toBe(4500)
  })

  it('takes a fixed amount off each place', async () => {
    const ticketType = await makeTicketType()
    await makePromo('TENOFF', { discountType: 'amount', amountOff: 1000 })
    await register(ticketType, 'TENOFF', 3)
    expect(await lastRegistration()).toMatchObject({ amount: 4500, discount: 3000 })
  })

  it('confirms at once, with no payment, when a code makes the places free', async () => {
    const ticketType = await makeTicketType()
    await makePromo('CREW', { percentOff: 100 })
    const before = checkouts.length
    const result = await register(ticketType, 'crew')
    expect(result).toMatchObject({ status: 'registered' })
    expect(checkouts).toHaveLength(before)
    if (result.status !== 'registered') throw new Error('not registered')
    const registration = await payload.findByID({ collection: 'registrations', id: result.registrationId!, overrideAccess: true })
    expect(registration).toMatchObject({ amount: 0, discount: 5000, status: 'confirmed' })
  })

  it('refuses codes that do not exist, fit another ticket, are paused or outside their dates', async () => {
    const ticketType = await makeTicketType()
    const other = await makeTicketType({ name: 'Other' })
    const free = await makeTicketType({ price: 0 })
    await makePromo('ONLYOTHER', { ticketTypes: [other.id] })
    await makePromo('PAUSED', { active: false })
    await makePromo('LATER', { startsAt: new Date(NOW + DAY).toISOString() })
    await makePromo('GONE', { endsAt: new Date(NOW - DAY).toISOString() })
    await makePromo('ANYFREE')
    for (const code of ['NOPE', 'ONLYOTHER', 'PAUSED', 'LATER', 'GONE', 'not a code!']) {
      expect(await register(ticketType, code)).toMatchObject({ errors: { promoCode: 'unknownCode' } })
    }
    expect(await register(free, 'ANYFREE')).toMatchObject({ errors: { promoCode: 'unknownCode' } })
    // A code from another event does not work here.
    await payload.create({
      collection: 'promo-codes',
      data: { event: otherEvent.id, code: 'OTHEREVENT', discountType: 'percent', percentOff: 50 } as never,
      overrideAccess: true,
    })
    expect(await register(ticketType, 'OTHEREVENT')).toMatchObject({ errors: { promoCode: 'unknownCode' } })
  })

  it('never sells more places at the code price than its limit, even all at once', async () => {
    const ticketType = await makeTicketType()
    const promo = await makePromo('THREE', { maxUses: 3 })
    expect(await register(ticketType, 'THREE', 2)).toMatchObject({ status: 'checkout' })
    expect(await register(ticketType, 'THREE', 2)).toMatchObject({ errors: { promoCode: 'usedUp' } })
    expect(await register(ticketType, 'THREE', 1)).toMatchObject({ status: 'checkout' })

    // Each on its own ticket, so only the code's own lock stands between them.
    const two = await makePromo('TWO', { maxUses: 2 })
    const tickets = await Promise.all(Array.from({ length: 5 }, () => makeTicketType()))
    const results = await Promise.allSettled(
      tickets.map((each) =>
        payload.create({
          collection: 'registrations',
          data: {
            ticketType: each.id,
            name: 'Rush',
            email: `${PREFIX}rush${++counter}@example.com`,
            quantity: 1,
            promoCode: two.id,
          } as never,
          overrideAccess: true,
        }),
      ),
    )
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(2)

    // A code people have used cannot be deleted; it can be paused.
    await expect(payload.delete({ collection: 'promo-codes', id: promo.id, overrideAccess: true })).rejects.toThrow(/Untick/)
  })

  it('charges what the code is worth when the registration is saved, not when the form was checked', async () => {
    const ticketType = await makeTicketType()
    const promo = await makePromo('HALFNOW', { percentOff: 100 })
    // Staff change the code from free to half price between the check and the save.
    await payload.update({ collection: 'promo-codes', id: promo.id, data: { percentOff: 50 }, overrideAccess: true })
    const result = await createRegistration({
      payload,
      tenantId: studioA.id,
      event,
      ticketType,
      input: { name: 'Maria Silva', email: `${PREFIX}stale@example.com`, quantity: 2 },
      locale: 'en',
      origin: 'https://studio.test',
      createCheckout: fakeCheckout,
      promo,
    })
    expect(result).toMatchObject({ reason: 'failed' })
    const { docs } = await payload.find({
      collection: 'registrations',
      where: { email: { equals: `${PREFIX}stale@example.com` } },
      overrideAccess: true,
    })
    expect(docs.map((d) => d.status)).toEqual(['cancelled'])
  })
})
