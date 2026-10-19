import { getPayload, type Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { productionsBetween, twelveMonthBounds, parseMonth } from '@/lib/calendar'
import { buildProductionCalendar } from '@/lib/ics'
import config from '@/payload.config'
import type { Tenant, User } from '@/payload-types'

import { ensureTenant } from '../helpers/seedTenant'

const PREFIX = 'int-calendar-export-'
const password = 'int-Password-1'
const window = twelveMonthBounds(parseMonth('2026-11'))

let payload: Payload
let studioA: Tenant
let studioB: Tenant
let managerA: User
let managerB: User

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

const cleanup = async () => {
  await payload.delete({ collection: 'projects', where: { title: { like: PREFIX } }, overrideAccess: true })
  await payload.delete({ collection: 'users', where: { email: { like: PREFIX } }, overrideAccess: true })
}

const shoot = (tenant: Tenant, title: string, shootDate: string | null) =>
  payload.create({
    collection: 'projects',
    data: {
      tenant: tenant.id,
      title: `${PREFIX}${title}`,
      clientName: 'Inês Lopes',
      notes: `${PREFIX}internal note`,
      status: 'confirmed',
      shootDate,
      location: 'Lisbon',
    },
    overrideAccess: true,
  })

describe('production calendar file', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    studioA = await ensureTenant(payload, { name: 'Int Studio A', slug: 'int-studio-a' })
    studioB = await ensureTenant(payload, { name: 'Int Studio B', slug: 'int-studio-b' })
    await cleanup()
    managerA = await makeUser('manager-a', studioA, ['production-manager'])
    managerB = await makeUser('manager-b', studioB, ['production-manager'])

    await shoot(studioA, 'in-window', '2026-11-14T00:00:00.000Z')
    await shoot(studioA, 'last-month-of-window', '2027-10-20T00:00:00.000Z')
    await shoot(studioA, 'after-window', '2027-11-01T00:00:00.000Z')
    await shoot(studioA, 'before-window', '2026-10-31T00:00:00.000Z')
    await shoot(studioA, 'undated', null)
    await shoot(studioB, 'other-studio', '2026-11-14T00:00:00.000Z')
  })

  afterAll(cleanup)

  it('lists only the studio’s own productions inside the twelve-month window', async () => {
    const seen = await productionsBetween(payload, managerA, studioA, window)
    expect(seen.map((p) => p.title).sort()).toEqual([
      `${PREFIX}in-window`,
      `${PREFIX}last-month-of-window`,
    ])
  })

  it('gives another studio’s staff nothing from studio A', async () => {
    const seen = await productionsBetween(payload, managerB, studioA, window)
    expect(seen).toEqual([])
  })

  it('writes only the calendar fields, so notes and client names stay out of the file', async () => {
    const seen = await productionsBetween(payload, managerA, studioA, window)
    const body = buildProductionCalendar({ productions: seen, calendarName: studioA.name, host: 'a.test' })
    expect(body).toContain(`SUMMARY:${PREFIX}in-window`)
    expect(body).toContain('LOCATION:Lisbon')
    expect(body).not.toContain('internal note')
    expect(body).not.toContain('Inês Lopes')
  })
})
