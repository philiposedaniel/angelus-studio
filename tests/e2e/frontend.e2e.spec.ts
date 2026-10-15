import { expect, test } from '@playwright/test'

import { seedE2ETenant } from '../helpers/seedUser'

test.describe('Public website', () => {
  test.beforeAll(async () => {
    await seedE2ETenant()
  })

  test('sends visitors to their language and renders the homepage', async ({ page }) => {
    await page.goto('http://localhost:3000')

    await expect(page).toHaveURL(/\/en$/)
    await expect(page).toHaveTitle(/Angelus/)
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')
    await expect(page.locator('h1').first()).toHaveText(/Angelus/)
    await expect(page.getByRole('link', { name: 'Book now' }).first()).toBeVisible()
  })

  test('shows the Spanish interface when Spanish is chosen', async ({ page }) => {
    await page.goto('http://localhost:3000/en')
    await page.getByRole('link', { name: 'es', exact: true }).click()

    await expect(page).toHaveURL(/\/es$/)
    await expect(page.locator('html')).toHaveAttribute('lang', 'es')
    await expect(page.getByRole('link', { name: 'Reservar' }).first()).toBeVisible()
  })

  test('redirects a language the studio does not offer', async ({ page }) => {
    await page.goto('http://localhost:3000/fr')
    await expect(page).toHaveURL(/\/en$/)
  })

  test('health check reports the database is reachable', async ({ request }) => {
    const response = await request.get('http://localhost:3000/healthz')
    expect(response.status()).toBe(200)
    expect(await response.json()).toEqual({ status: 'ok' })
  })
})
