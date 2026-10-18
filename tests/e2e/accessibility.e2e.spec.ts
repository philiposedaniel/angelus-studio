import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { getPayload } from 'payload'

import { MIN_FILL_MS } from '../../src/lib/inquiries.js'
import config from '../../src/payload.config.js'
import { waitForHydration } from '../helpers/hydration'
import { E2E_TENANT, seedE2ETenant } from '../helpers/seedUser'

/**
 * The pages guests, buyers, vendors and hosts open, usually on a phone: no WCAG 2.2 A or AA
 * violations axe can detect, nothing wider than a small phone screen, and the forms usable
 * from the keyboard alone.
 */

const BASE = 'http://localhost:3000'
const PREFIX = 'e2e-a11y-'
const host = { email: `${PREFIX}host@angelus.test`, password: 'e2e-Password-1' }
const PHONE = { width: 360, height: 740 }

const paths: Record<string, string> = {}
let organizerPath = ''

async function expectAccessible(page: Page) {
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()
  expect(
    violations.map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(' ')).join(', ')})`),
  ).toEqual([])
}

async function expectFitsPhone(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(overflow).toBeLessThanOrEqual(0)
}

test.describe('Event pages on a phone', () => {
  test.use({ viewport: PHONE })

  test.beforeAll(async () => {
    await seedE2ETenant()
    const payload = await getPayload({ config })
    const tenant = (await payload.find({ collection: 'tenants', where: { slug: { equals: E2E_TENANT.slug } } })).docs[0]!
    await payload.delete({ collection: 'events', where: { slug: { like: PREFIX } } })
    await payload.delete({ collection: 'vendors', where: { name: { like: PREFIX } } })
    await payload.delete({ collection: 'users', where: { email: { like: PREFIX } } })
    const hostUser = await payload.create({
      collection: 'users',
      data: { ...host, roles: ['user'], tenants: [{ tenant: tenant.id, roles: ['event-organizer'] }] },
    })
    const event = await payload.create({
      collection: 'events',
      data: {
        tenant: tenant.id,
        title: `${PREFIX}Summer screening`,
        slug: `${PREFIX}screening`,
        startsAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
        timeZone: 'Europe/Lisbon',
        location: 'The studio, Lisbon',
        summary: 'An evening of short films made at the studio this year.',
        published: true,
        listed: true,
        organizers: [hostUser.id],
        mealOptions: [{ label: 'Fish' }, { label: 'Vegetarian' }],
      },
    })
    const open = await payload.create({
      collection: 'ticket-types',
      data: { event: event.id, name: 'Seat', capacity: 50, maxPerOrder: 4, sortOrder: 1, price: 0, currency: 'eur' },
    })
    const full = await payload.create({
      collection: 'ticket-types',
      data: { event: event.id, name: 'Front row', capacity: 1, maxPerOrder: 1, sortOrder: 2, price: 0, currency: 'eur' },
    })
    const registration = await payload.create({
      collection: 'registrations',
      data: { ticketType: open.id, name: 'Rita Lopes', email: 'rita@example.com', quantity: 2, status: 'confirmed', language: 'en' },
    })
    await payload.create({
      collection: 'registrations',
      data: { ticketType: full.id, name: 'Early bird', email: 'early@example.com', quantity: 1, status: 'confirmed', language: 'en' },
    })
    const waiting = await payload.create({
      collection: 'waitlist-entries',
      data: { ticketType: full.id, name: 'Nuno Reis', email: 'nuno@example.com', quantity: 1, language: 'en' } as never,
    })
    const guest = await payload.create({
      collection: 'event-guests',
      data: { event: event.id, name: 'Maria Silva', partySize: 2, language: 'en', rsvpStatus: 'pending' },
    })
    for (const name of ['Bruno Dias', 'Carla Mendes']) {
      await payload.create({ collection: 'event-guests', data: { event: event.id, name, partySize: 1, language: 'en', rsvpStatus: 'pending' } })
    }
    const [fish, vegetarian] = event.mealOptions!.map((option) => option.id!)
    await payload.create({
      collection: 'event-guests',
      data: {
        event: event.id,
        name: 'Ana Costa',
        partySize: 2,
        language: 'en',
        rsvpStatus: 'attending',
        attendingCount: 2,
        party: [{ name: 'Ana Costa', meal: fish }, { name: 'Rui Costa', meal: vegetarian }],
      },
    })
    const vendor = await payload.create({ collection: 'vendors', data: { tenant: tenant.id, name: `${PREFIX}Lisbon Sound`, category: 'music' } })
    const booking = await payload.create({
      collection: 'event-vendors',
      data: { event: event.id, vendor: vendor.id, role: 'Sound', status: 'booked', currency: 'eur' },
    })

    paths.events = '/en/events'
    paths.event = `/en/events/${PREFIX}screening`
    paths.ticket = `/en/tickets/${registration.ticketToken}`
    paths.waitlist = `/en/waitlist/${waiting.claimToken}`
    paths.invitation = `/en/invite/${guest.inviteToken}`
    paths.vendor = `/en/vendor/${booking.vendorToken}`
    paths.login = '/en/portal/login'
    organizerPath = `/en/portal/events/${event.id}`
  })

  for (const name of ['events', 'event', 'ticket', 'waitlist', 'invitation', 'vendor', 'login']) {
    test(`the ${name} page is accessible and fits a phone`, async ({ page }) => {
      await page.goto(`${BASE}${paths[name]}`)
      await expect(page.locator('h1')).toBeVisible()
      await expectAccessible(page)
      await expectFitsPhone(page)
    })
  }

  test("the host's guest list is accessible and fits a phone", async ({ page }) => {
    await page.goto(`${BASE}/en/portal/login`)
    await waitForHydration(page)
    await page.getByLabel('Email').fill(host.email)
    await page.getByLabel('Password').fill(host.password)
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page).toHaveURL(/\/en\/portal$/, { timeout: 20_000 })
    await expectAccessible(page)
    await expectFitsPhone(page)

    await page.goto(`${BASE}${organizerPath}`)
    await expect(page.getByText('Showing 1–4 of 4 guests')).toBeVisible()
    // The meal counts and who is coming, for the host to pass on to the caterer.
    await expect(page.getByText('Fish: 1')).toBeVisible()
    await expect(page.getByText('Not chosen yet')).toHaveCount(0)
    await expect(page.getByText('Ana Costa (Fish), Rui Costa (Vegetarian)')).toBeVisible()
    await expectAccessible(page)
    await expectFitsPhone(page)

    // The search narrows the list, from the keyboard alone.
    await page.getByLabel('Find a guest by name or email').focus()
    await page.keyboard.type('bruno')
    await page.keyboard.press('Enter')
    await expect(page.getByText('Showing 1–1 of 1 guests')).toBeVisible()
    await expect(page.getByText('Bruno Dias')).toBeVisible()
    await expect(page.getByText('Maria Silva')).toHaveCount(0)
    await page.getByRole('link', { name: 'Show everyone' }).click()
    await expect(page.getByText('Showing 1–4 of 4 guests')).toBeVisible()
  })

  test('a visitor registers for a ticket with the keyboard alone', async ({ page }) => {
    await page.goto(`${BASE}${paths.event}`)
    await waitForHydration(page)
    const form = page.getByRole('form', { name: 'Register' })
    await form.getByLabel('Full name').focus()
    await page.keyboard.type('Inês Sousa')
    await page.keyboard.press('Tab')
    await expect(form.getByLabel('Email')).toBeFocused()
    await page.keyboard.type('ines@example.com')
    // Tab on to the consent box and the button, as someone without a mouse would.
    const tabTo = async (target: ReturnType<Page['getByRole']>) => {
      for (let i = 0; i < 20 && !(await target.evaluate((el) => el === document.activeElement)); i++) {
        await page.keyboard.press('Tab')
      }
      await expect(target).toBeFocused()
    }
    await tabTo(form.getByRole('checkbox'))
    await page.keyboard.press('Space')
    await expect(form.getByRole('checkbox')).toBeChecked()
    await tabTo(form.getByRole('button', { name: 'Register' }))
    await page.waitForTimeout(MIN_FILL_MS)
    await page.keyboard.press('Enter')
    await page.waitForURL(/\/en\/tickets\/[A-Za-z0-9_-]{32}$/)
    await expect(page.getByText('Inês Sousa')).toBeVisible()
  })
})
