import { getPayload, type Payload } from 'payload'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import config from '@/payload.config'
import type { Tenant } from '@/payload-types'
import { busyDays } from '@/lib/availability'

import { ensureTenant } from '../helpers/seedTenant'

const PREFIX = 'int-availability-'
const WINDOW = { start: '2026-12-01T00:00:00.000Z', end: '2027-01-01T00:00:00.000Z' }
let payload: Payload
let studio: Tenant
let other: Tenant

const production = (
  tenant: Tenant,
  title: string,
  status: 'planning' | 'confirmed' | 'in-production' | 'closed',
  shootDate: string,
) =>
  payload.create({
    collection: 'projects',
    data: { tenant: tenant.id, title: `${PREFIX}${title}`, clientName: 'Client', status, shootDate },
    overrideAccess: true,
  })

const event = (tenant: Tenant, title: string, published: boolean, startsAt: string) =>
  payload.create({
    collection: 'events',
    data: {
      tenant: tenant.id,
      title: `${PREFIX}${title}`,
      slug: `${PREFIX}${title}`.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      startsAt,
      timeZone: 'Europe/Lisbon',
      published,
    },
    overrideAccess: true,
  })

describe('studio availability', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    studio = await ensureTenant(payload, { name: 'Int Availability', slug: 'int-availability' })
    other = await ensureTenant(payload, { name: 'Int Availability Other', slug: 'int-availability-other' })
  })

  const clean = async () => {
    await payload.delete({ collection: 'events', where: { title: { like: PREFIX } }, overrideAccess: true })
    await payload.delete({ collection: 'projects', where: { title: { like: PREFIX } }, overrideAccess: true })
  }

  beforeEach(clean)
  afterAll(clean)

  it('marks a day booked for a confirmed production and a published event, and nothing else', async () => {
    await production(studio, 'confirmed shoot', 'confirmed', '2026-12-05T00:00:00.000Z')
    await production(studio, 'planning shoot', 'planning', '2026-12-06T00:00:00.000Z')
    await production(studio, 'closed shoot', 'closed', '2026-12-07T00:00:00.000Z')
    await event(studio, 'published event', true, '2026-12-10T19:00:00.000Z')
    await event(studio, 'draft event', false, '2026-12-11T19:00:00.000Z')

    expect(await busyDays(payload, studio.id, WINDOW)).toEqual(['2026-12-05', '2026-12-10'])
  })

  it('does not show one studio\'s bookings to another studio', async () => {
    await production(studio, 'confirmed shoot', 'in-production', '2026-12-05T00:00:00.000Z')
    expect(await busyDays(payload, other.id, WINDOW)).toEqual([])
  })

  it('counts only days inside the window', async () => {
    await production(studio, 'january shoot', 'confirmed', '2027-01-03T00:00:00.000Z')
    expect(await busyDays(payload, studio.id, WINDOW)).toEqual([])
  })

  it('returns days only, never a title or client', async () => {
    await production(studio, 'secret title', 'confirmed', '2026-12-08T00:00:00.000Z')
    const days = await busyDays(payload, studio.id, WINDOW)
    expect(days.every((day) => /^\d{4}-\d{2}-\d{2}$/.test(day))).toBe(true)
  })
})
