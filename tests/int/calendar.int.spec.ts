import { getPayload, type Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import config from '@/payload.config'
import { parseMonth, productionsInMonth } from '@/lib/calendar'
import type { Tenant, User } from '@/payload-types'

import { ensureTenant } from '../helpers/seedTenant'

const PREFIX = 'int-calendar-'
const password = 'int-Password-1'
const november = parseMonth('2026-11')

let payload: Payload
let studioA: Tenant
let studioB: Tenant
let managerA: User
let managerB: User
let clientA: User

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
    data: { tenant: tenant.id, title: `${PREFIX}${title}`, clientName: 'Inês Lopes', status: 'confirmed', shootDate, location: 'Lisbon' },
    overrideAccess: true,
  })

describe('production calendar', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    studioA = await ensureTenant(payload, { name: 'Int Studio A', slug: 'int-studio-a' })
    studioB = await ensureTenant(payload, { name: 'Int Studio B', slug: 'int-studio-b' })
    await cleanup()
    managerA = await makeUser('manager-a', studioA, ['production-manager'])
    managerB = await makeUser('manager-b', studioB, ['production-manager'])
    clientA = await makeUser('client-a', studioA, ['client'])

    await shoot(studioA, 'mid-month', '2026-11-14T00:00:00.000Z')
    await shoot(studioA, 'last-day', '2026-11-30T00:00:00.000Z')
    await shoot(studioA, 'next-month', '2026-12-01T00:00:00.000Z')
    await shoot(studioA, 'last-month', '2026-10-31T00:00:00.000Z')
    await shoot(studioA, 'undated', null)
    await shoot(studioB, 'other-studio', '2026-11-14T00:00:00.000Z')
  })

  afterAll(cleanup)

  it('shows a studio its own productions in the month, with the last day included and the next month left out', async () => {
    const seen = await productionsInMonth(payload, managerA, studioA, november)
    expect(seen.map((p) => p.title).sort()).toEqual([`${PREFIX}last-day`, `${PREFIX}mid-month`])
  })

  it('shows only the calendar fields, never notes, quotes or client details', async () => {
    const [first] = await productionsInMonth(payload, managerA, studioA, november)
    expect(Object.keys(first ?? {}).sort()).toEqual(['id', 'location', 'shootDate', 'status', 'title'])
  })

  it('never shows another studio’s productions', async () => {
    const seen = await productionsInMonth(payload, managerB, studioB, november)
    expect(seen.map((p) => p.title)).toEqual([`${PREFIX}other-studio`])
    // Asking for studio A’s calendar as studio B staff gives nothing.
    expect(await productionsInMonth(payload, managerB, studioA, november)).toEqual([])
  })

  it('does not show the studio calendar to a client who is not on the production', async () => {
    expect(await productionsInMonth(payload, clientA, studioA, november)).toEqual([])
  })
})
