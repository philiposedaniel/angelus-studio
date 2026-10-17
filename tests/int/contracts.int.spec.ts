import { getPayload, type Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import config from '@/payload.config'
import type { Tenant, User } from '@/payload-types'
import { termsFingerprint } from '@/lib/contracts'

import { ensureTenant } from '../helpers/seedTenant'

const PREFIX = 'int-contract-'
const password = 'int-Password-1'
const TERMS = 'The photographer arrives at 08:00 and stays until the last dance.'

let payload: Payload
let studioA: Tenant
let managerA: User

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
  await payload.delete({ collection: 'quotes', where: { title: { like: PREFIX } }, overrideAccess: true })
  await payload.delete({ collection: 'users', where: { email: { like: PREFIX } }, overrideAccess: true })
}

/** What the signing action writes, through the Local API as the server does. */
const recordSignature = (id: number, terms: string) =>
  payload.update({
    collection: 'quotes',
    id,
    data: {
      contract: {
        terms,
        signedName: 'Maria Silva',
        signedAt: '2026-10-16T07:30:00.000Z',
        signedIp: '203.0.113.7',
        signedUserAgent: 'int-test',
        termsFingerprint: termsFingerprint(terms),
      },
    },
    overrideAccess: true,
  })

describe('quote contracts', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    studioA = await ensureTenant(payload, { name: 'Int Studio A', slug: 'int-studio-a' })
    await cleanup()
    managerA = await makeUser('manager-a', studioA, ['production-manager'])
  })

  afterAll(cleanup)

  const newQuote = (title: string) =>
    payload.create({
      collection: 'quotes',
      data: {
        tenant: studioA.id,
        title: `${PREFIX}${title}`,
        clientName: 'Maria Silva',
        clientEmail: `${PREFIX}maria@example.com`,
        currency: 'eur',
        lineItems: [{ description: 'Full day coverage', quantity: 2, unitAmount: 5000 }],
        depositPercent: 30,
        status: 'sent',
        contract: { terms: TERMS },
      },
      overrideAccess: true,
    })

  it('lets staff write the terms, and never the signature', async () => {
    const quote = await newQuote('forge')
    const updated = await payload.update({
      collection: 'quotes',
      id: quote.id,
      user: managerA,
      overrideAccess: false,
      data: {
        contract: {
          terms: `${TERMS} Overtime is billed hourly.`,
          signedName: 'Forged Name',
          signedAt: '2020-01-01T00:00:00.000Z',
          termsFingerprint: 'forged',
        },
      },
    })
    expect(updated.contract?.terms).toContain('Overtime is billed hourly.')
    expect(updated.contract?.signedName ?? null).toBeNull()
    expect(updated.contract?.signedAt ?? null).toBeNull()
    expect(updated.contract?.termsFingerprint ?? null).toBeNull()
  })

  it('records a signature with the terms it was given, and shows it to staff', async () => {
    const quote = await newQuote('signed')
    const signed = await recordSignature(quote.id, TERMS)
    expect(signed.contract?.signedName).toBe('Maria Silva')
    expect(signed.contract?.termsFingerprint).toBe(termsFingerprint(TERMS))

    const seen = await payload.findByID({ collection: 'quotes', id: quote.id, user: managerA, overrideAccess: false })
    expect(seen.contract?.signedName).toBe('Maria Silva')
    expect(seen.contract?.signedIp).toBe('203.0.113.7')
  })

  it('will not change the terms or the prices once the client has signed', async () => {
    const quote = await newQuote('locked')
    await recordSignature(quote.id, TERMS)

    await expect(
      payload.update({
        collection: 'quotes',
        id: quote.id,
        data: { contract: { terms: 'A different deal' } },
        overrideAccess: true,
      }),
    ).rejects.toThrow(/cannot change after the client has signed/)

    await expect(
      payload.update({
        collection: 'quotes',
        id: quote.id,
        data: { lineItems: [{ description: 'Cheaper', quantity: 1, unitAmount: 1000 }] },
        overrideAccess: true,
      }),
    ).rejects.toThrow(/signed or paid quote cannot change/)

    // Saving the same terms again, as the admin does, is not a change.
    await expect(
      payload.update({ collection: 'quotes', id: quote.id, data: { notes: 'Called the client.' }, overrideAccess: true }),
    ).resolves.toMatchObject({ contract: { terms: TERMS } })
  })
})
