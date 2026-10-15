import { getPayload, type Payload } from 'payload'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { issueFormToken, MAX_PER_SENDER_PER_HOUR, MIN_FILL_MS, submitInquiry } from '@/lib/inquiries'
import config from '@/payload.config'
import type { Tenant, User } from '@/payload-types'

import { ensureTenant } from '../helpers/seedTenant'

const PREFIX = 'int-inq-'
const password = 'int-Password-1'

let payload: Payload
let studioA: Tenant
let studioB: Tenant
let managerA: User
let managerB: User
let editorA: User
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

const NOW = Date.now()
let counter = 0

/** A filled-in form as a person would send it, a few seconds after the page loaded. */
const filled = (tenant: Tenant, overrides: Record<string, string> = {}) => {
  const data = new FormData()
  const values: Record<string, string> = {
    formToken: issueFormToken(tenant.id, NOW - MIN_FILL_MS - 1000),
    name: 'Maria Silva',
    email: `${PREFIX}visitor${++counter}@example.com`,
    eventType: 'wedding',
    message: 'We are getting married next summer.',
    consent: 'on',
    ...overrides,
  }
  for (const [key, value] of Object.entries(values)) data.set(key, value)
  return data
}

const submit = (tenant: Tenant, form: FormData, address = '203.0.113.7') =>
  submitInquiry({ payload, tenantId: tenant.id, locale: 'en', form, address, now: NOW })

const saved = async () =>
  (await payload.find({ collection: 'inquiries', where: { email: { like: PREFIX } }, depth: 0, pagination: false }))
    .docs

describe('website inquiries', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    studioA = await ensureTenant(payload, { name: 'Int Studio A', slug: 'int-studio-a' })
    studioB = await ensureTenant(payload, { name: 'Int Studio B', slug: 'int-studio-b' })
    await payload.delete({ collection: 'users', where: { email: { like: PREFIX } } })
    managerA = await makeUser('manager-a', studioA, ['production-manager'])
    managerB = await makeUser('manager-b', studioB, ['production-manager'])
    editorA = await makeUser('editor-a', studioA, ['editor'])
    clientA = await makeUser('client-a', studioA, ['client'])
  })

  beforeEach(async () => {
    await payload.delete({ collection: 'inquiries', where: { email: { like: PREFIX } } })
  })

  afterAll(async () => {
    await payload.delete({ collection: 'inquiries', where: { email: { like: PREFIX } } })
    await payload.delete({ collection: 'users', where: { email: { like: PREFIX } } })
  })

  it('saves a genuine request for the studio whose site it came from', async () => {
    expect(await submit(studioA, filled(studioA))).toEqual({ status: 'success' })
    const [inquiry] = await saved()
    expect(inquiry).toMatchObject({ name: 'Maria Silva', status: 'new', locale: 'en', tenant: studioA.id })
  })

  it('quietly drops bots: the hidden field, instant submissions and link spam', async () => {
    expect(await submit(studioA, filled(studioA, { website: 'http://spam.example' }))).toEqual({ status: 'success' })
    expect(
      await submit(studioA, filled(studioA, { formToken: issueFormToken(studioA.id, NOW - 500) })),
    ).toEqual({ status: 'success' })
    expect(
      await submit(studioA, filled(studioA, { message: 'https://a https://b https://c https://d' })),
    ).toEqual({ status: 'success' })
    expect(await saved()).toHaveLength(0)
  })

  it('shows missing fields even when the form is sent straight away', async () => {
    const quick = filled(studioA, { formToken: issueFormToken(studioA.id, NOW - 500), name: '' })
    expect(await submit(studioA, quick)).toEqual({ status: 'error', errors: { name: 'required' } })
  })

  it('refuses a form issued for another studio, or a forged one', async () => {
    expect(await submit(studioA, filled(studioB))).toEqual({ status: 'error', reason: 'expired' })
    expect(await submit(studioA, filled(studioA, { formToken: `${NOW}.forged` }))).toEqual({
      status: 'error',
      reason: 'expired',
    })
    expect(await saved()).toHaveLength(0)
  })

  it('reports invalid fields without saving', async () => {
    const result = await submit(studioA, filled(studioA, { email: 'not-an-email', consent: '' }))
    expect(result).toEqual({ status: 'error', errors: { email: 'invalid', consent: 'required' } })
    expect(await saved()).toHaveLength(0)
  })

  it('limits how many requests one sender can make in an hour', async () => {
    for (let i = 0; i < MAX_PER_SENDER_PER_HOUR; i++) {
      expect(await submit(studioA, filled(studioA), '198.51.100.9')).toEqual({ status: 'success' })
    }
    expect(await submit(studioA, filled(studioA), '198.51.100.9')).toEqual({ status: 'error', reason: 'tooMany' })
    // Someone else is not affected.
    expect(await submit(studioA, filled(studioA), '198.51.100.10')).toEqual({ status: 'success' })
  })

  it('shows requests only to the studio’s managers, never to other studios, editors or clients', async () => {
    await submit(studioA, filled(studioA))
    const visibleTo = async (user: User) =>
      (
        await payload.find({
          collection: 'inquiries',
          user,
          overrideAccess: false,
          where: { email: { like: PREFIX } },
        })
      ).docs
    const [forManager] = await visibleTo(managerA)
    expect(forManager).toBeDefined()
    // The sender hash is never shown, even to staff.
    expect(forManager).not.toHaveProperty('senderKey')
    expect(await visibleTo(managerB)).toHaveLength(0)
    await expect(visibleTo(editorA)).rejects.toThrow()
    await expect(visibleTo(clientA)).rejects.toThrow()
  })

  it('cannot be created through the API, even by staff', async () => {
    const data = { tenant: studioA.id, name: 'x', email: `${PREFIX}api@example.com`, eventType: 'other', message: 'x' }
    await expect(payload.create({ collection: 'inquiries', data: data as never, overrideAccess: false })).rejects.toThrow()
    await expect(
      payload.create({ collection: 'inquiries', data: data as never, user: managerA, overrideAccess: false }),
    ).rejects.toThrow()
  })
})
