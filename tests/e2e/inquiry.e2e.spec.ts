import { expect, test } from '@playwright/test'
import { getPayload } from 'payload'

import config from '../../src/payload.config.js'
import { seedE2ETenant } from '../helpers/seedUser'

const BASE = 'http://localhost:3000'
const EMAIL = 'e2e-inquiry@example.com'

test.describe('Website inquiry form', () => {
  test.beforeAll(async () => {
    await seedE2ETenant()
    const payload = await getPayload({ config })
    await payload.delete({ collection: 'inquiries', where: { email: { equals: EMAIL } } })
  })

  test('a visitor sends a request and the studio receives it', async ({ page }) => {
    await page.goto(`${BASE}/en`)
    const form = page.locator('form', { has: page.getByRole('button', { name: 'Send request' }) })

    // Sending an empty form shows what is missing, without leaving the page.
    await page.waitForLoadState('networkidle')
    await form
      .getByLabel('Tell us more')
      .fill('We are getting married next June, about 120 guests.')
    await form.getByRole('button', { name: 'Send request' }).click()
    await expect(form.getByText('Please fill this in.').first()).toBeVisible()
    // What the visitor already typed is kept.
    await expect(form.getByLabel('Tell us more')).toHaveValue(
      'We are getting married next June, about 120 guests.',
    )

    await form.getByLabel('Your name').fill('Maria Silva')
    await form.getByLabel('Email').fill(EMAIL)
    await form.getByLabel('Type of production').selectOption('wedding')
    await form.getByLabel('Location (optional)').fill('Sintra')
    await form.getByLabel(/I agree/).check()
    // Forms sent within 3 seconds of loading are treated as bots, so take a person's time.
    await page.waitForTimeout(3000)
    await form.getByRole('button', { name: 'Send request' }).click()
    await expect(page.getByRole('status')).toHaveText(/Thank you/)

    const payload = await getPayload({ config })
    const { docs } = await payload.find({
      collection: 'inquiries',
      where: { email: { equals: EMAIL } },
    })
    expect(docs).toHaveLength(1)
    expect(docs[0]).toMatchObject({
      name: 'Maria Silva',
      eventType: 'wedding',
      location: 'Sintra',
      status: 'new',
    })
  })
})
