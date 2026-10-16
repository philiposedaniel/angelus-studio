import { expect, test, type Page } from '@playwright/test'
import { getPayload } from 'payload'

import config from '../../src/payload.config.js'
import { E2E_TENANT, seedE2ETenant } from '../helpers/seedUser'

const BASE = 'http://localhost:3000'
const PREFIX = 'e2e-calendar-'
const password = 'e2e-Password-1'
const manager = { email: `${PREFIX}manager@angelus.test`, password }
const client = { email: `${PREFIX}client@angelus.test`, password }

// A date in the current month, so the default calendar view shows it.
const now = new Date()
const shootDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 15, 0, 0, 0)).toISOString()

test.describe('Production calendar', () => {
  test.beforeAll(async () => {
    await seedE2ETenant()
    const payload = await getPayload({ config })
    const { docs } = await payload.find({ collection: 'tenants', where: { slug: { equals: E2E_TENANT.slug } } })
    const tenant = docs[0]!
    await payload.delete({ collection: 'projects', where: { title: { like: PREFIX } }, overrideAccess: true })
    await payload.delete({ collection: 'users', where: { email: { like: PREFIX } }, overrideAccess: true })

    await payload.create({
      collection: 'users',
      data: { ...manager, roles: ['user'], tenants: [{ tenant: tenant.id, roles: ['production-manager'] }] },
    })
    await payload.create({
      collection: 'users',
      data: { ...client, roles: ['user'], tenants: [{ tenant: tenant.id, roles: ['client'] }] },
    })
    await payload.create({
      collection: 'projects',
      data: {
        tenant: tenant.id,
        title: `${PREFIX}Harbour wedding`,
        clientName: 'Inês Lopes',
        status: 'confirmed',
        shootDate: shootDay,
        location: 'Cascais harbour',
      },
      overrideAccess: true,
    })
  })

  const signIn = async (page: Page, user: typeof manager) => {
    await page.goto(`${BASE}/en/portal/login`)
    await page.waitForLoadState('networkidle')
    await page.getByLabel('Email').fill(user.email)
    await page.getByLabel('Password').fill(user.password)
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page).toHaveURL(/\/en\/portal$/, { timeout: 20_000 })
  }

  test('a production manager sees the studio’s shoot days for the month', async ({ page }) => {
    await signIn(page, manager)
    await page.getByRole('link', { name: 'Production calendar' }).click()
    await expect(page.getByRole('heading', { name: 'Production calendar', level: 1 })).toBeVisible()
    await expect(page.getByRole('heading', { name: `${PREFIX}Harbour wedding`, level: 3 })).toBeVisible()
    await expect(page.getByText('Confirmed · Location: Cascais harbour')).toBeVisible()
  })

  test('a client sees an empty calendar, not an error', async ({ page }) => {
    await signIn(page, client)
    const response = await page.goto(`${BASE}/en/portal/calendar`)
    expect(response?.status()).toBe(200)
    await expect(page.getByText('No productions this month.')).toBeVisible()
    await expect(page.getByText(`${PREFIX}Harbour wedding`)).toHaveCount(0)
  })
})
