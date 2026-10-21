import AxeBuilder from '@axe-core/playwright'
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
let seatedEventId: number

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
    await payload.delete({ collection: 'vendors', where: { name: { like: PREFIX } } })
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
    const vendor = await payload.create({
      collection: 'vendors',
      data: { tenant: tenant.id, name: `${PREFIX}Lisbon Sound`, category: 'music', phone: '+351 900 000 000' },
    })
    await payload.create({
      collection: 'event-vendors',
      data: {
        event: event.id,
        vendor: vendor.id,
        role: 'DJ for the reception',
        status: 'confirmed',
        arrivalAt: '2027-06-12T13:00:00.000Z',
        currency: 'eur',
        amountDue: 120000,
        staffNotes: 'Negotiated down',
      } as never,
    })
    await payload.create({
      collection: 'ticket-types',
      data: { event: event.id, name: 'Reception seats', capacity: 20, maxPerOrder: 5 } as never,
    })
    const dinner = await payload.create({
      collection: 'events',
      data: {
        tenant: tenant.id,
        title: `${PREFIX}Anniversary dinner`,
        slug: `${PREFIX}dinner`,
        startsAt: '2027-07-10T19:00:00.000Z',
        timeZone: 'Europe/Lisbon',
        published: false,
        organizers: [hostUser.id],
      },
    })
    seatedEventId = dinner.id
    await payload.create({
      collection: 'event-tables',
      data: { event: dinner.id, name: 'Head table', capacity: 8, notes: 'Keep away from the speakers' } as never,
    })
    await payload.create({ collection: 'event-guests', data: { event: dinner.id, name: 'Rui Almeida', partySize: 2 } as never })
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

  test('the host sees who is working the event and how tickets sell, without the money', async ({ page }) => {
    await signIn(page, host)
    await page.goto(`${BASE}/en/portal/events/${eventId}`)
    await expect(page.getByRole('heading', { name: 'Vendors' })).toBeVisible()
    await expect(page.getByText(`${PREFIX}Lisbon Sound · DJ for the reception`)).toBeVisible()
    await expect(page.getByText(/Arrives .*Confirmed/)).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Tickets' })).toBeVisible()
    await expect(page.getByText('0 of 20 sold')).toBeVisible()
    const text = await page.locator('main').innerText()
    for (const hidden of ['1,200', '1200', 'Negotiated', '+351']) expect(text).not.toContain(hidden)
  })

  test('the host seats a guest at one of the tables the studio set up', async ({ page }) => {
    await signIn(page, host)
    await page.goto(`${BASE}/en/portal/events/${seatedEventId}`)
    await expect(page.getByRole('heading', { name: 'Seating' })).toBeVisible()
    await expect(page.getByText('0 of 8 seats taken · 2 still without a table')).toBeVisible()
    await expect(page.getByRole('link', { name: 'Download the seating plan (PDF)' })).toBeVisible()
    await expect(page.locator('main')).not.toContainText('speakers')

    await page.getByRole('link', { name: 'Change' }).click()
    await expect(page.getByRole('heading', { name: 'Change guest' })).toBeVisible()
    await waitForHydration(page)
    await page.getByLabel('Table', { exact: true }).selectOption({ label: 'Head table' })
    await page.getByRole('button', { name: 'Save changes' }).click()
    await expect(page.getByText('2 of 8 seats taken')).toBeVisible()
    await expect(page.getByText('2 of 8 seats', { exact: true })).toBeVisible()
    await expect(page.getByText('Rui Almeida', { exact: true }).first()).toBeVisible()

    // The list narrows to a table, or to the guests still without one.
    await page.getByLabel('Seated at').selectOption({ label: 'No table yet' })
    await page.getByRole('button', { name: 'Search' }).click()
    await expect(page).toHaveURL(/table=none/)
    await expect(page.getByText('No guests match that search.')).toBeVisible()
    await page.getByLabel('Seated at').selectOption({ label: 'Head table' })
    await page.getByLabel('Reply', { exact: true }).selectOption({ label: 'Not answered' })
    await page.getByRole('button', { name: 'Search' }).click()
    await expect(page.getByText('Showing 1–1 of 1 guests')).toBeVisible()
    await page.getByRole('link', { name: 'Show everyone' }).click()
    await expect(page).toHaveURL(`${BASE}/en/portal/events/${seatedEventId}`)

    // Ticked guests are seated, or taken off their tables, together.
    await waitForHydration(page)
    await page.getByRole('button', { name: 'Seat', exact: true }).click()
    await expect(page.getByText('Tick at least one guest in the list first.')).toBeVisible()
    await page.getByLabel('Select Rui Almeida').check()
    await page.getByLabel('Seat the ticked guests at').selectOption({ label: 'No table (take them off their tables)' })
    await page.getByRole('button', { name: 'Seat', exact: true }).click()
    await expect(page.getByText('1 guest taken off their table.')).toBeVisible()
    await expect(page.getByText('0 of 8 seats taken · 2 still without a table')).toBeVisible()
    await expect(page.getByLabel('Select Rui Almeida')).not.toBeChecked()
    await page.getByLabel('Select Rui Almeida').check()
    await page.getByLabel('Seat the ticked guests at').selectOption({ label: 'Head table' })
    await page.getByRole('button', { name: 'Seat', exact: true }).click()
    await expect(page.getByText('1 guest seated.')).toBeVisible()
    await expect(page.getByText('2 of 8 seats taken')).toBeVisible()

    // The seating tools stay accessible, and fit a phone.
    await page.setViewportSize({ width: 360, height: 780 })
    const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()
    expect(violations.map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(' ')).join(', ')})`)).toEqual([])
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0)
  })

  test('the host adds guests from a spreadsheet after checking it', async ({ page }) => {
    await signIn(page, host)
    await page.goto(`${BASE}/en/portal/events/${eventId}`)
    await waitForHydration(page)
    await page.getByLabel('Guest list file (CSV)').setInputFiles({
      name: 'guests.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from('Name,Email,Party size\nInês Duarte,ines@example.com,2\nPaulo Reis,,1\n,missing@example.com,1\n'),
    })
    await expect(page.getByText('2 guests ready to add. 1 row has a problem and is left out.')).toBeVisible()
    await expect(page.getByText('Line 4: the name is missing.')).toBeVisible()
    await expect(page.getByText('Inês Duarte', { exact: true })).toHaveCount(0)

    await page.getByRole('button', { name: 'Add 2 guests' }).click()
    await expect(page.getByText('2 guests added.')).toBeVisible()
    await expect(page.getByText('Inês Duarte', { exact: true })).toBeVisible()
    await expect(page.getByText('Paulo Reis', { exact: true })).toBeVisible()

    // A link in a language the studio's site does not offer opens the same page in one it does.
    const payload = await getPayload({ config })
    const ines = (await payload.find({ collection: 'event-guests', where: { email: { equals: 'ines@example.com' } } })).docs[0]!
    await page.goto(`${BASE}/fr/invite/${ines.inviteToken}`)
    await expect(page).toHaveURL(`${BASE}/en/invite/${ines.inviteToken}`)
    await page.goto(`${BASE}/fr/portal/events/${eventId}?q=paulo`)
    await expect(page).toHaveURL(`${BASE}/en/portal/events/${eventId}?q=paulo`)
    await expect(page.getByText('Showing 1–1 of 1 guests')).toBeVisible()
  })

  test('someone who does not organize the event cannot open its guest list', async ({ page }) => {
    await signIn(page, outsider)
    await expect(page.getByText(`${PREFIX}Ana and João`)).toHaveCount(0)
    const response = await page.goto(`${BASE}/en/portal/events/${eventId}`)
    expect(response?.status()).toBe(404)
  })
})
