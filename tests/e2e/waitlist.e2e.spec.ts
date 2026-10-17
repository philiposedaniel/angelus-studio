import { expect, test } from '@playwright/test'
import { getPayload } from 'payload'

import { MIN_FILL_MS } from '../../src/lib/inquiries.js'
import config from '../../src/payload.config.js'
import { waitForHydration } from '../helpers/hydration'
import { E2E_TENANT, seedTestUser } from '../helpers/seedUser'

const BASE = 'http://localhost:3000'
const PREFIX = 'e2e-waitlist-'

let earlyBird = 0

test.describe('Ticket waitlist', () => {
  test.beforeAll(async () => {
    await seedTestUser()
    const payload = await getPayload({ config })
    const { docs } = await payload.find({ collection: 'tenants', where: { slug: { equals: E2E_TENANT.slug } } })
    const tenant = docs[0]!
    // Deleting the events removes their ticket types, registrations and waitlists.
    await payload.delete({ collection: 'events', where: { slug: { like: PREFIX } } })

    const event = await payload.create({
      collection: 'events',
      data: {
        tenant: tenant.id,
        title: `${PREFIX}Lighting masterclass`,
        slug: `${PREFIX}masterclass`,
        startsAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
        timeZone: 'Europe/Lisbon',
        location: 'The studio, Lisbon',
        published: true,
        listed: true,
      },
    })
    const ticketType = await payload.create({
      collection: 'ticket-types',
      data: { event: event.id, name: 'Masterclass seat', capacity: 1, maxPerOrder: 2, sortOrder: 1, price: 0, currency: 'eur' },
    })
    const taken = await payload.create({
      collection: 'registrations',
      data: { ticketType: ticketType.id, name: 'Early bird', email: 'early@example.com', quantity: 1, status: 'confirmed', language: 'en' },
    })
    earlyBird = taken.id
  })

  test('a visitor joins the waitlist of a sold-out ticket and takes the place when it frees up', async ({ page }) => {
    await page.goto(`${BASE}/en/events/${PREFIX}masterclass`)
    await expect(page.getByText('Sold out', { exact: true })).toBeVisible()
    await expect(page.getByRole('form', { name: 'Register' })).toHaveCount(0)
    await waitForHydration(page)

    const form = page.getByRole('form', { name: 'Join the waitlist' })
    await form.getByLabel('Full name').fill('Rita Lopes')
    await form.getByLabel('Email').fill('rita@example.com')
    await form.getByLabel('I agree that the studio keeps these details').check()
    await page.waitForTimeout(MIN_FILL_MS)
    await form.getByRole('button', { name: 'Join the waitlist' }).click()

    await page.waitForURL(/\/en\/waitlist\/[A-Za-z0-9_-]{32}$/)
    const waitlistUrl = page.url()
    await expect(page.getByRole('heading', { name: `${PREFIX}Lighting masterclass`, level: 1 })).toBeVisible()
    await expect(page.getByText('You are number 1 in line.')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Take my places' })).toHaveCount(0)

    await page.goto(`${BASE}/en/events/${PREFIX}masterclass`)
    await expect(page.getByText('Sold out · 1 person waiting')).toBeVisible()

    // The early bird cancels: the place is held for the person waiting, not put back on sale.
    const payload = await getPayload({ config })
    await payload.update({ collection: 'registrations', id: earlyBird, data: { status: 'cancelled' } })
    await page.goto(`${BASE}/en/events/${PREFIX}masterclass`)
    await expect(page.getByText('Sold out', { exact: true })).toBeVisible()

    await page.goto(waitlistUrl)
    await expect(page.getByText(/Good news: places are being held for you until/)).toBeVisible()
    await page.screenshot({ path: 'test-results/waitlist-offer.png', fullPage: true })
    await waitForHydration(page)
    await page.getByRole('button', { name: 'Take my places' }).click()

    await page.waitForURL(/\/en\/tickets\/[A-Za-z0-9_-]{32}$/)
    await expect(page.getByText('Rita Lopes')).toBeVisible()
    await expect(page.getByRole('img', { name: 'Your entry code' })).toBeVisible()

    // The waitlist link now points to the ticket.
    await page.goto(waitlistUrl)
    await expect(page.getByText('You have taken your places.')).toBeVisible()
    await expect(page.getByRole('link', { name: 'Open your ticket' })).toBeVisible()
  })

  test('the waitlist link opens in Spanish, and an unknown one shows nothing', async ({ page }) => {
    await page.goto(`${BASE}/es/events/${PREFIX}masterclass`)
    await expect(page.getByRole('heading', { name: 'Entradas' })).toBeVisible()
    const response = await page.goto(`${BASE}/en/waitlist/${'A'.repeat(32)}`)
    expect(response?.status()).toBe(404)
  })
})
