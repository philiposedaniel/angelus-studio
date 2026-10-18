import { expect, test, type Page } from '@playwright/test'
import { getPayload } from 'payload'

import config from '../../src/payload.config.js'
import { waitForHydration } from '../helpers/hydration'
import { E2E_TENANT, seedE2ETenant } from '../helpers/seedUser'

const BASE = 'http://localhost:3000'
const PREFIX = 'e2e-organizer-'
const host = { email: `${PREFIX}host@angelus.test`, password: 'e2e-Password-1' }
const outsider = { email: `${PREFIX}outsider@angelus.test`, password: 'e2e-Password-1' }

let eventId: number

async function signIn(page: Page, user: { email: string; password: string }) {
  await page.goto(`${BASE}/en/portal/login`)
  await waitForHydration(page)
  await page.getByLabel('Email').fill(user.email)
  await page.getByLabel('Password').fill(user.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/en\/portal$/, { timeout: 20_000 })
}

test.describe('Organizers manage their guest list', () => {
  test.beforeAll(async () => {
    await seedE2ETenant()
    const payload = await getPayload({ config })
    const tenant = (await payload.find({ collection: 'tenants', where: { slug: { equals: E2E_TENANT.slug } } })).docs[0]!
    await payload.delete({ collection: 'events', where: { slug: { like: PREFIX } } })
    await payload.delete({ collection: 'users', where: { email: { like: PREFIX } } })
    const makeUser = (data: typeof host) =>
      payload.create({
        collection: 'users',
        data: { ...data, roles: ['user'], tenants: [{ tenant: tenant.id, roles: ['event-organizer'] }] },
      })
    const hostUser = await makeUser(host)
    await makeUser(outsider)
    const event = await payload.create({
      collection: 'events',
      data: {
        tenant: tenant.id,
        title: `${PREFIX}Ana and João`,
        slug: `${PREFIX}wedding`,
        startsAt: '2027-06-12T15:00:00.000Z',
        timeZone: 'Europe/Lisbon',
        published: false,
        organizers: [hostUser.id],
      },
    })
    eventId = event.id
  })

  test('the host adds, changes and removes guests from their portal', async ({ page }) => {
    await signIn(page, host)
    await page.getByRole('link', { name: new RegExp(`${PREFIX}Ana and João`) }).click()
    await expect(page.getByRole('heading', { name: `${PREFIX}Ana and João`, level: 1 })).toBeVisible()
    await expect(page.getByText('No guests yet.')).toBeVisible()
    await waitForHydration(page)

    await page.getByLabel('Name', { exact: true }).fill('Maria Silva')
    await page.getByLabel('Email (optional)').fill('maria@example.com')
    await page.getByLabel('Seats on the invitation').fill('2')
    await page.getByRole('button', { name: 'Add guest' }).click()
    await expect(page.getByText('Guest added.')).toBeVisible()
    await expect(page.getByText('Maria Silva')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Copy invitation link' })).toBeVisible()

    await page.getByRole('link', { name: 'Change' }).click()
    await expect(page.getByRole('heading', { name: 'Change guest' })).toBeVisible()
    await waitForHydration(page)
    await page.getByLabel('Name', { exact: true }).fill('Maria Costa')
    await page.getByRole('button', { name: 'Save changes' }).click()
    await expect(page.getByText('Maria Costa')).toBeVisible()

    page.once('dialog', (dialog) => dialog.accept())
    await page.getByRole('button', { name: 'Remove' }).click()
    await expect(page.getByText('No guests yet.')).toBeVisible()
  })

  test('someone who does not organize the event cannot open its guest list', async ({ page }) => {
    await signIn(page, outsider)
    await expect(page.getByText(`${PREFIX}Ana and João`)).toHaveCount(0)
    const response = await page.goto(`${BASE}/en/portal/events/${eventId}`)
    expect(response?.status()).toBe(404)
  })
})
