import { expect, test } from '@playwright/test'
import { getPayload } from 'payload'

import config from '../../src/payload.config.js'
import { E2E_TENANT, seedE2ETenant } from '../helpers/seedUser'

const BASE = 'http://localhost:3000'
const PREFIX = 'e2e-vendor-'

let token = ''
let cancelledToken = ''
let bookingId: number

test.describe('Vendor links', () => {
  test.beforeAll(async () => {
    await seedE2ETenant()
    const payload = await getPayload({ config })
    const { docs } = await payload.find({ collection: 'tenants', where: { slug: { equals: E2E_TENANT.slug } } })
    const tenant = docs[0]!
    await payload.delete({ collection: 'events', where: { slug: { like: PREFIX } } })
    await payload.delete({ collection: 'vendors', where: { name: { like: PREFIX } } })

    const event = await payload.create({
      collection: 'events',
      data: {
        tenant: tenant.id,
        title: `${PREFIX}Ana and João`,
        slug: `${PREFIX}wedding`,
        startsAt: '2027-06-12T15:00:00.000Z',
        timeZone: 'Europe/Lisbon',
        location: 'Quinta da Regaleira, Sintra',
        published: false,
      },
    })
    const vendor = await payload.create({
      collection: 'vendors',
      data: { tenant: tenant.id, name: `${PREFIX}DJ Sol`, category: 'music' },
    })
    const booking = await payload.create({
      collection: 'event-vendors',
      data: {
        event: event.id,
        vendor: vendor.id,
        role: 'DJ for the reception',
        status: 'booked',
        currency: 'eur',
        amountDue: 120000,
        arrivalAt: '2027-06-12T14:00:00.000Z',
        instructions: 'Load in through the north gate.',
        staffNotes: 'Agreed discount for next year.',
      },
    })
    const cancelled = await payload.create({
      collection: 'event-vendors',
      data: { event: event.id, vendor: vendor.id, role: 'Cancelled set', status: 'cancelled', currency: 'eur' },
    })
    bookingId = booking.id
    token = booking.vendorToken!
    cancelledToken = cancelled.vendorToken!
  })

  test('a vendor sees their booking, without amounts or staff notes, and confirms it', async ({ page }) => {
    await page.goto(`${BASE}/en/vendor/${token}`)
    await expect(page.getByRole('heading', { name: `${PREFIX}Ana and João`, level: 1 })).toBeVisible()
    await expect(page.getByText('DJ for the reception')).toBeVisible()
    await expect(page.getByText('Load in through the north gate.')).toBeVisible()
    await expect(page.getByText('3:00 PM')).toBeVisible()
    await expect(page.getByText('1,200')).toHaveCount(0)
    await expect(page.getByText('Agreed discount')).toHaveCount(0)

    await page.getByLabel('A note for the studio (optional)').fill('We need two power sockets.')
    await page.getByRole('button', { name: 'Confirm I will be there' }).click()
    // The page reloads with the booking confirmed.
    await expect(page.getByText(/Your booking is confirmed|You have confirmed this booking/)).toBeVisible()

    const payload = await getPayload({ config })
    const saved = await payload.findByID({ collection: 'event-vendors', id: bookingId })
    expect(saved).toMatchObject({ status: 'confirmed', vendorNote: 'We need two power sockets.' })
  })

  test('a cancelled booking or unknown link shows nothing', async ({ page }) => {
    expect((await page.goto(`${BASE}/en/vendor/${cancelledToken}`))?.status()).toBe(404)
    expect((await page.goto(`${BASE}/en/vendor/${'A'.repeat(32)}`))?.status()).toBe(404)
  })
})
