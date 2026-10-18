import { expect, test, type Page } from '@playwright/test'
import { getPayload } from 'payload'

import config from '../../src/payload.config.js'
import { E2E_TENANT, seedE2ETenant } from '../helpers/seedUser'

const BASE = 'http://localhost:3000'
const PREFIX = 'e2e-crew-'
const password = 'e2e-Password-1'
const crew = { email: `${PREFIX}photographer@angelus.test`, password }
const client = { email: `${PREFIX}client@angelus.test`, password }
const title = `${PREFIX}Gala`

/** A production with a crew member and an assigned client, and a call sheet only the crew may read. */
async function seed() {
  await seedE2ETenant()
  const payload = await getPayload({ config })
  const { docs } = await payload.find({ collection: 'tenants', where: { slug: { equals: E2E_TENANT.slug } } })
  const tenant = docs[0]!
  await payload.delete({ collection: 'projects', where: { title: { like: PREFIX } } })
  await payload.delete({ collection: 'users', where: { email: { like: PREFIX } } })

  const photographer = await payload.create({
    collection: 'users',
    data: { ...crew, roles: ['user'], tenants: [{ tenant: tenant.id, roles: ['photographer'] }] },
  })
  const clientUser = await payload.create({
    collection: 'users',
    data: { ...client, roles: ['user'], tenants: [{ tenant: tenant.id, roles: ['client'] }] },
  })
  await payload.create({
    collection: 'projects',
    data: {
      tenant: tenant.id,
      title,
      clientName: 'Ana Lopez',
      status: 'confirmed',
      shootDate: '2099-06-01',
      location: 'Lisbon',
      clientUser: clientUser.id,
      crew: [{ user: photographer.id, role: 'photographer' }],
      callSheet: {
        meetingPoint: 'Hotel lobby, Rua Augusta 10',
        notes: 'Bring spare batteries.',
        schedule: [{ time: '07:30', item: 'Arrive and set up', location: 'Studio gate' }],
      },
    },
  })
}

/** Signs in through the login form, so later requests carry the browser's session cookie. */
const signIn = async (page: Page, user: typeof crew) => {
  await page.goto(`${BASE}/en/portal/login`)
  // Let the form hydrate first, or the dev server's reload can wipe what was typed.
  await page.waitForLoadState('networkidle')
  await page.getByLabel('Email').fill(user.email)
  await page.getByLabel('Password').fill(user.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  // The first sign-in can wait on the dev server compiling the route.
  await expect(page).toHaveURL(/\/en\/portal$/, { timeout: 20_000 })
}

test.describe('Crew call sheet', () => {
  test.beforeAll(async () => {
    await seed()
  })

  test.afterAll(async () => {
    const payload = await getPayload({ config })
    await payload.delete({ collection: 'projects', where: { title: { like: PREFIX } } })
    await payload.delete({ collection: 'users', where: { email: { like: PREFIX } } })
  })

  test('shows the call sheet to crew on the job', async ({ page }) => {
    await signIn(page, crew)
    await page.goto(`${BASE}/en/portal/projects`)
    await page.getByRole('link', { name: title }).click()

    await expect(page.getByRole('heading', { name: 'Call sheet' })).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText('Hotel lobby, Rua Augusta 10')).toBeVisible()
    await expect(page.getByText('Bring spare batteries.')).toBeVisible()
    await expect(page.getByText('Arrive and set up')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Print call sheet' })).toBeVisible()
  })

  test('never shows the call sheet to the assigned client', async ({ page }) => {
    await signIn(page, client)
    await page.goto(`${BASE}/en/portal/projects`)
    await page.getByRole('link', { name: title }).click()

    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible({ timeout: 20_000 })
    await expect(page.getByRole('heading', { name: 'Call sheet' })).toHaveCount(0)
    await expect(page.getByText('Hotel lobby, Rua Augusta 10')).toHaveCount(0)
    await expect(page.getByText('Bring spare batteries.')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Print call sheet' })).toHaveCount(0)
  })
})
