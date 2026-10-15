import { getPayload } from 'payload'
import config from '../../src/payload.config.js'
import { ensureTenant } from './seedTenant.js'

export const testUser = {
  email: 'e2e-admin@angelus.test',
  password: 'e2e-Password-1',
}

export const E2E_TENANT = {
  name: 'Angelus Media Productions',
  slug: 'angelus',
  languages: ['en', 'es'] as ('en' | 'es')[],
}

/** Ensures the default studio exists with English and Spanish enabled. */
export async function seedE2ETenant(): Promise<void> {
  const payload = await getPayload({ config })
  await ensureTenant(payload, E2E_TENANT)
}

/**
 * Seeds the studio and a studio administrator for e2e tests.
 */
export async function seedTestUser(): Promise<void> {
  const payload = await getPayload({ config })
  const tenant = await ensureTenant(payload, E2E_TENANT)

  await payload.delete({
    collection: 'users',
    where: { email: { equals: testUser.email } },
  })

  await payload.create({
    collection: 'users',
    data: { ...testUser, roles: ['user'], tenants: [{ tenant: tenant.id, roles: ['admin'] }] },
  })
}

/**
 * Cleans up test user after tests
 */
export async function cleanupTestUser(): Promise<void> {
  const payload = await getPayload({ config })

  await payload.delete({
    collection: 'users',
    where: { email: { equals: testUser.email } },
  })
}
