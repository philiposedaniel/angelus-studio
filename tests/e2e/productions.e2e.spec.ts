import { expect, test, type Page } from '@playwright/test'
import { getPayload } from 'payload'

import config from '../../src/payload.config.js'
import { E2E_TENANT, seedE2ETenant } from '../helpers/seedUser'

const BASE = 'http://localhost:3000'
const PREFIX = 'e2e-production-'
const password = 'e2e-Password-1'
const TITLE = `${PREFIX}Porto gala`
const client = { email: `${PREFIX}client@angelus.test`, password }
const otherClient = { email: `${PREFIX}other@angelus.test`, password }
const crew = { email: `${PREFIX}crew@angelus.test`, password }

test.describe('Productions in the client and crew portal', () => {
  test.beforeAll(async () => {
    await seedE2ETenant()
    const payload = await getPayload({ config })
    const { docs } = await payload.find({ collection: 'tenants', where: { slug: { equals: E2E_TENANT.slug } } })
    const tenant = docs[0]!

    await payload.delete({ collection: 'projects', where: { title: { like: PREFIX } }, overrideAccess: true })
    await payload.delete({ collection: 'users', where: { email: { like: PREFIX } }, overrideAccess: true })

    const makeUser = (data: typeof client, role: string) =>
      payload.create({
        collection: 'users',
        data: { ...data, roles: ['user'], tenants: [{ tenant: tenant.id, roles: [role as never] }] },
        overrideAccess: true,
      })
    const clientUser = await makeUser(client, 'client')
    await makeUser(otherClient, 'client')
    const crewUser = await makeUser(crew, 'photographer')

    await payload.create({
      collection: 'projects',
      data: {
        tenant: tenant.id,
        title: TITLE,
        clientName: 'Inês Lopes',
        clientEmail: client.email,
        clientUser: clientUser.id,
        status: 'confirmed',
        shootDate: '2027-03-14',
        location: 'Porto',
        notes: `${PREFIX}internal note`,
        crew: [{ user: crewUser.id, role: 'Lead photographer' }],
      },
      overrideAccess: true,
    })
  })

  const signIn = async (page: Page, user: typeof client) => {
    await page.goto(`${BASE}/en/portal/login`)
    // Let the form hydrate first, or the dev server's reload can wipe what was typed.
    await page.waitForLoadState('networkidle')
    await page.getByLabel('Email').fill(user.email)
    await page.getByLabel('Password').fill(user.password)
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page).toHaveURL(/\/en\/portal$/, { timeout: 20_000 })
  }

  test('the assigned client sees the production, without internal notes or the crew', async ({ page }) => {
    await signIn(page, client)
    await page.getByRole('link', { name: 'Your productions' }).click()
    await expect(page.getByRole('heading', { name: 'Your productions' })).toBeVisible()
    await expect(page.getByRole('heading', { name: TITLE })).toBeVisible()
    await expect(page.getByText('Location: Porto')).toBeVisible()
    await expect(page.getByText(`${PREFIX}internal note`)).toHaveCount(0)
    await expect(page.getByText('Lead photographer')).toHaveCount(0)
  })

  test('a crew member sees the production they work on', async ({ page }) => {
    await signIn(page, crew)
    await page.goto(`${BASE}/en/portal/projects`)
    await expect(page.getByRole('heading', { name: TITLE })).toBeVisible()
  })

  test('another client of the studio sees that they have no productions', async ({ page }) => {
    await signIn(page, otherClient)
    await page.goto(`${BASE}/en/portal/projects`)
    await expect(page.getByText('You have no productions to see yet.')).toBeVisible()
    await expect(page.getByRole('heading', { name: TITLE })).toHaveCount(0)
  })
})
