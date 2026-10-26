import { expect, test } from '@playwright/test'
import { getPayload } from 'payload'

import { MIN_FILL_MS } from '../../src/lib/inquiries.js'
import config from '../../src/payload.config.js'
import { waitForHydration } from '../helpers/hydration'
import { login } from '../helpers/login'
import { E2E_TENANT, seedTestUser, testUser } from '../helpers/seedUser'

const BASE = 'http://localhost:3000'
const PREFIX = 'e2e-tickets-'

let waitingToken = ''
let freeToken = ''
let paidToken = ''

test.describe('Event registration and tickets', () => {
  test.beforeAll(async () => {
    // Seeds the studio and a studio administrator, who checks tickets in.
    await seedTestUser()
    const payload = await getPayload({ config })
    const { docs } = await payload.find({ collection: 'tenants', where: { slug: { equals: E2E_TENANT.slug } } })
    const tenant = docs[0]!
    // Deleting the events removes their ticket types and registrations, and with them the rate limits.
    await payload.delete({ collection: 'events', where: { slug: { like: PREFIX } } })

    const event = await payload.create({
      collection: 'events',
      data: {
        tenant: tenant.id,
        title: `${PREFIX}Open day`,
        slug: `${PREFIX}open-day`,
        startsAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
        timeZone: 'Europe/Lisbon',
        location: 'The studio, Lisbon',
        published: true,
        listed: true,
      },
    })
    await payload.create({
      collection: 'ticket-types',
      data: { event: event.id, name: 'General admission', capacity: 40, maxPerOrder: 4, sortOrder: 1, price: 0, currency: 'eur' },
    })
    const full = await payload.create({
      collection: 'ticket-types',
      data: { event: event.id, name: 'Workshop', capacity: 1, maxPerOrder: 1, sortOrder: 2, price: 0, currency: 'eur' },
    })
    // Paid, but this server has no Stripe keys: shown with its price, never offered.
    const gala = await payload.create({
      collection: 'ticket-types',
      data: { event: event.id, name: 'Gala dinner', capacity: 20, maxPerOrder: 2, sortOrder: 3, price: 4500, currency: 'eur' },
    })
    const waiting = await payload.create({
      collection: 'registrations',
      data: {
        ticketType: gala.id,
        name: 'Paying guest',
        email: 'paying@example.com',
        quantity: 2,
        status: 'pending',
        language: 'en',
        holdExpiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
      },
    })
    waitingToken = waiting.ticketToken!
    // On an event of its own, so cancelling it does not change the places counted above.
    const otherDay = await payload.create({
      collection: 'events',
      data: {
        tenant: tenant.id,
        title: `${PREFIX}Second day`,
        slug: `${PREFIX}second-day`,
        startsAt: new Date(Date.now() + 31 * 86_400_000).toISOString(),
        timeZone: 'Europe/Lisbon',
        published: true,
      },
    })
    const otherAdmission = await payload.create({
      collection: 'ticket-types',
      data: { event: otherDay.id, name: 'General admission', capacity: 10, maxPerOrder: 4, price: 0, currency: 'eur' },
    })
    freeToken = (
      await payload.create({
        collection: 'registrations',
        data: { ticketType: otherAdmission.id, name: 'Changed plans', email: 'plans@example.com', quantity: 2, status: 'confirmed', language: 'en' },
      })
    ).ticketToken!
    paidToken = (
      await payload.create({
        collection: 'registrations',
        data: { ticketType: gala.id, name: 'Paid guest', email: 'paid@example.com', quantity: 1, status: 'confirmed', language: 'en' },
      })
    ).ticketToken!
    await payload.create({
      collection: 'registrations',
      data: { ticketType: full.id, name: 'Early bird', email: 'early@example.com', quantity: 1, status: 'confirmed', language: 'en' },
    })
  })

  test('a visitor registers on the event page, gets a ticket, and staff check it in', async ({ page }) => {
    // Walks through five pages and a sign-in; on a cold dev server each compiles on first visit.
    test.slow()
    await page.goto(`${BASE}/en/events/${PREFIX}open-day`)
    await expect(page.getByRole('heading', { name: 'Tickets', exact: true })).toBeVisible()
    await expect(page.getByText('40 places left')).toBeVisible()
    await expect(page.getByText('Sold out', { exact: true })).toBeVisible()
    await waitForHydration(page)

    // The sold-out ticket is not offered in the form; it has a waitlist instead.
    const form = page.getByRole('form', { name: 'Register' })
    await expect(form.getByLabel('Ticket').locator('option')).toHaveCount(1)
    await expect(page.getByRole('form', { name: 'Join the waitlist' }).getByLabel('Ticket')).toHaveText(/Workshop/)
    await form.getByLabel('Places').selectOption('2')
    await form.getByLabel('Full name').fill('Maria Silva')
    await form.getByLabel('Email').fill('maria@example.com')
    await form.getByLabel('I agree that the studio keeps these details').check()
    // People take a few seconds to fill a form; faster is treated as a bot.
    await page.waitForTimeout(MIN_FILL_MS)
    await form.getByRole('button', { name: 'Register' }).click()

    await page.waitForURL(/\/en\/tickets\/[A-Za-z0-9_-]{32}$/)
    const ticketUrl = page.url()
    await expect(page.getByRole('heading', { name: `${PREFIX}Open day`, level: 1 })).toBeVisible()
    await expect(page.getByText('Maria Silva')).toBeVisible()
    await expect(page.getByText('Admits 2 people.')).toBeVisible()
    await expect(page.getByRole('img', { name: 'Your entry code' })).toBeVisible()

    const payload = await getPayload({ config })
    const { docs } = await payload.find({ collection: 'registrations', where: { email: { equals: 'maria@example.com' } } })
    expect(docs).toHaveLength(1)
    expect(docs[0]).toMatchObject({ name: 'Maria Silva', quantity: 2, status: 'confirmed' })

    // The event page now shows two fewer places.
    await page.goto(`${BASE}/en/events/${PREFIX}open-day`)
    await expect(page.getByText('38 places left')).toBeVisible()

    // Anyone else who opens the entry code is only told to show it.
    await page.goto(`${ticketUrl}/check-in`)
    await expect(page.getByRole('heading', { name: 'Show this code at the entrance' })).toBeVisible()
    await expect(page.getByText('Maria Silva')).toHaveCount(0)

    await login({ page, user: testUser })
    await page.goto(`${ticketUrl}/check-in`)
    await expect(page.getByRole('heading', { name: 'Maria Silva' })).toBeVisible()
    await expect(page.getByText('General admission')).toBeVisible()
    await waitForHydration(page)
    await page.getByLabel('How many have arrived?').selectOption('2')
    await page.getByRole('button', { name: 'Check in' }).click()
    await expect(page.getByText('Checked in.')).toBeVisible()
    const saved = await payload.findByID({ collection: 'registrations', id: docs[0]!.id })
    expect(saved.checkedInCount).toBe(2)

    // A cancelled registration is flagged at the door and its ticket says so.
    await payload.update({ collection: 'registrations', id: docs[0]!.id, data: { status: 'cancelled' } })
    await page.goto(`${ticketUrl}/check-in`)
    await expect(page.getByText('Cancelled registration. Do not admit.')).toBeVisible()
    await page.goto(ticketUrl)
    await expect(page.getByText('This registration was cancelled.')).toBeVisible()
    await expect(page.getByRole('img', { name: 'Your entry code' })).toHaveCount(0)
  })

  test('a paid ticket shows its price, and a ticket waiting for payment has no entry code yet', async ({ page }) => {
    await page.goto(`${BASE}/en/events/${PREFIX}open-day`)
    await expect(page.getByText('€45.00')).toBeVisible()
    await expect(page.getByText('Not available')).toBeVisible()
    await expect(page.getByRole('form', { name: 'Register' }).getByLabel('Ticket').locator('option', { hasText: 'Gala dinner' })).toHaveCount(0)

    await page.goto(`${BASE}/en/tickets/${waitingToken}`)
    await expect(page.getByText('Total: €90.00')).toBeVisible()
    await expect(page.getByText('We are confirming your payment.')).toBeVisible()
    await expect(page.getByRole('img', { name: 'Your entry code' })).toHaveCount(0)
  })

  test('the holder gives back a place, then cancels a free ticket, and a paid one points to the studio', async ({ page }) => {
    await page.goto(`${BASE}/en/tickets/${freeToken}`)
    await expect(page.getByRole('img', { name: 'Your entry code' })).toBeVisible()
    await expect(page.getByText('Admits 2 people.')).toBeVisible()
    await waitForHydration(page)
    // One of the two places is given back first.
    await expect(page.getByLabel('Places to keep')).toHaveValue('1')
    await page.getByRole('button', { name: 'Give back the other places' }).click()
    // With one place left the form goes away, and the ticket and the result say what it admits now.
    await expect(page.getByText('Done: your ticket now admits 1 person.')).toBeVisible()
    await expect(page.getByText('Admits 1 person.', { exact: true })).toBeVisible()
    await expect(page.getByLabel('Places to keep')).toHaveCount(0)

    page.once('dialog', (dialog) => void dialog.accept())
    await page.getByRole('button', { name: 'Cancel my registration' }).click()
    await expect(page.getByText('This registration was cancelled.')).toBeVisible()
    await expect(page.getByRole('img', { name: 'Your entry code' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Cancel my registration' })).toHaveCount(0)

    await page.goto(`${BASE}/en/tickets/${paidToken}`)
    await expect(page.getByText('To cancel a paid ticket, contact the studio')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Cancel my registration' })).toHaveCount(0)
  })

  test('the ticket opens in Spanish, and an unknown ticket shows nothing', async ({ page }) => {
    await page.goto(`${BASE}/es/events/${PREFIX}open-day`)
    await expect(page.getByRole('heading', { name: 'Entradas' })).toBeVisible()
    const response = await page.goto(`${BASE}/en/tickets/${'A'.repeat(32)}`)
    expect(response?.status()).toBe(404)
  })
})
