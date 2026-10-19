import { getPayload, type Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { checkStoredCode, disableMfa, enableMfa, MFA_MAX_FAILED_CODES, requireMfaCodeAtLogin } from '@/lib/mfa'
import { base32Decode, hotp, totpCounter } from '@/lib/totp'
import config from '@/payload.config'
import type { Tenant, User } from '@/payload-types'

import { ensureTenant } from '../helpers/seedTenant'

const PREFIX = 'int-mfa-'
const password = 'int-Password-1'

let payload: Payload
let studioA: Tenant
let studioB: Tenant
let staffA: User
let adminA: User
let adminB: User

const codeAt = (secret: string, at: Date) => hotp(base32Decode(secret), totpCounter(at))
const SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP' // 32 base32 characters, for tests only

const makeUser = async (name: string, tenant: Tenant, roles: string[]) => {
  const created = await payload.create({
    collection: 'users',
    data: {
      email: `${PREFIX}${name}@angelus.test`,
      password,
      roles: ['user'],
      tenants: [{ tenant: tenant.id, roles: roles as never }],
    },
    overrideAccess: true,
  })
  return payload.findByID({ collection: 'users', id: created.id, depth: 0, overrideAccess: true })
}

const cleanup = async () => {
  await payload.delete({ collection: 'users', where: { email: { like: PREFIX } }, overrideAccess: true })
}

const reload = (user: User) => payload.findByID({ collection: 'users', id: user.id, depth: 0, overrideAccess: true })

describe('staff authenticator sign-in', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    studioA = await ensureTenant(payload, { name: 'Int MFA Studio A', slug: 'int-mfa-studio-a' })
    studioB = await ensureTenant(payload, { name: 'Int MFA Studio B', slug: 'int-mfa-studio-b' })
    await cleanup()
    staffA = await makeUser('staff-a', studioA, ['production-manager'])
    adminA = await makeUser('admin-a', studioA, ['admin'])
    adminB = await makeUser('admin-b', studioB, ['admin'])
  })

  afterAll(cleanup)

  it('turns on only with a code from the secret it was given, and never shows the secret through the API', async () => {
    expect(await enableMfa(payload, staffA.id, SECRET, '000000', new Date(0))).toBe(false)
    expect((await reload(staffA)).mfaEnabled).toBe(false)

    expect(await enableMfa(payload, staffA.id, SECRET, codeAt(SECRET, new Date()))).toBe(true)
    const asStaff = await payload.findByID({ collection: 'users', id: staffA.id, depth: 0, overrideAccess: false, user: staffA })
    expect(asStaff.mfaEnabled).toBe(true)
    expect(asStaff).not.toHaveProperty('mfaSecret')
  })

  it('refuses a sign-in with a wrong or missing code, and accepts a code from a later step', async () => {
    expect(await checkStoredCode(payload, staffA.id, '')).toBe('wrong')
    expect(await checkStoredCode(payload, staffA.id, '123456', new Date())).toBe('wrong')
    const later = new Date(Date.now() + 30_000)
    expect(await checkStoredCode(payload, staffA.id, codeAt(SECRET, later), later)).toBe('ok')
  })

  it('does not accept the same code twice', async () => {
    const later = new Date(Date.now() + 60_000)
    const code = codeAt(SECRET, later)
    expect(await checkStoredCode(payload, staffA.id, code, later)).toBe('ok')
    expect(await checkStoredCode(payload, staffA.id, code, later)).toBe('wrong')
  })

  it('locks the code check after too many wrong codes', async () => {
    const at = new Date(Date.now() + 10 * 60 * 1000)
    let last: string = 'wrong'
    for (let i = 0; i < MFA_MAX_FAILED_CODES; i += 1) {
      last = await checkStoredCode(payload, staffA.id, '000001', at)
    }
    expect(last).toBe('locked')
    const correct = codeAt(SECRET, at)
    expect(await checkStoredCode(payload, staffA.id, correct, at)).toBe('locked')
    // Clear the lock for the rest of the tests.
    await payload.update({ collection: 'users', id: staffA.id, data: { mfaLockedUntil: null, mfaFailedAttempts: 0 }, overrideAccess: true })
  })

  it('turns off only with a current code', async () => {
    expect(await disableMfa(payload, staffA.id, '000002')).toBe('wrong')
    const later = new Date(Date.now() + 120_000)
    expect(await disableMfa(payload, staffA.id, codeAt(SECRET, later), later)).toBe('ok')
    const after = await reload(staffA)
    expect(after.mfaEnabled).toBe(false)
  })

  it('lets a studio admin of the same studio clear authenticator sign-in, but not another studio’s admin', async () => {
    await enableMfa(payload, staffA.id, SECRET, codeAt(SECRET, new Date(Date.now() + 120_000)), new Date(Date.now() + 120_000))
    expect((await reload(staffA)).mfaEnabled).toBe(true)

    await expect(
      payload.update({ collection: 'users', id: staffA.id, data: { mfaReset: true }, user: adminB, overrideAccess: false }),
    ).rejects.toThrow()
    expect((await reload(staffA)).mfaEnabled).toBe(true)

    await payload.update({ collection: 'users', id: staffA.id, data: { mfaReset: true }, user: adminA, overrideAccess: false })
    const cleared = await reload(staffA)
    expect(cleared.mfaEnabled).toBe(false)
  })

  it('reads the code from the sign-in body: missing or wrong refused, current accepted', async () => {
    const past = new Date(Date.now() - 120_000)
    expect(await enableMfa(payload, staffA.id, SECRET, codeAt(SECRET, past), past)).toBe(true)
    const user = await reload(staffA)

    await expect(requireMfaCodeAtLogin({ req: { payload, data: {} }, user } as never)).rejects.toThrow(
      'authenticator code is missing or wrong',
    )
    await expect(
      requireMfaCodeAtLogin({ req: { payload, data: { totp: '000000' } }, user } as never),
    ).rejects.toThrow('authenticator code is missing or wrong')

    const returned = await requireMfaCodeAtLogin({
      req: { payload, data: { totp: codeAt(SECRET, new Date()) } },
      user,
    } as never)
    expect(returned).toEqual(user)
  })

  it('lets a user without authenticator sign-in through without a code', async () => {
    const plain = await reload(adminB)
    expect(plain.mfaEnabled).toBeFalsy()
    expect(await requireMfaCodeAtLogin({ req: { payload, data: {} }, user: plain } as never)).toEqual(plain)
  })
})
