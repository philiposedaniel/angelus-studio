import { expect, test } from '@playwright/test'

test.describe('Public website', () => {
  test('homepage renders the company name and booking call to action', async ({ page }) => {
    await page.goto('http://localhost:3000')

    await expect(page).toHaveTitle(/Angelus/)
    await expect(page.locator('h1').first()).toHaveText(/Angelus/)
    await expect(page.getByRole('link', { name: 'Book now' }).first()).toBeVisible()
  })

  test('health check reports the database is reachable', async ({ request }) => {
    const response = await request.get('http://localhost:3000/healthz')
    expect(response.status()).toBe(200)
    expect(await response.json()).toEqual({ status: 'ok' })
  })
})
