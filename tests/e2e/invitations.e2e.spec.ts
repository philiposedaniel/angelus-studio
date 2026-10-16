import { expect, test } from '@playwright/test'
import { getPayload } from 'payload'

import config from '../../src/payload.config.js'
import { E2E_TENANT, seedE2ETenant } from '../helpers/seedUser'

const BASE = 'http://localhost:3000'
const PREFIX = 'e2e-invite-'

let openToken = ''
let closedToken = ''
let guestId: number

test.describe('Invitations and RSVP', () => {
  test.beforeAll(async () => {
    await seedE2ETenant()
    const payload = await getPayload({ config })
    const { docs } = await payload.find({ collection: 'tenants', where: { slug: { equals: E2E_TENANT.slug } } })
    const tenant = docs[0]!
    await payload.delete({ collection: 'events', where: { slug: { like: PREFIX } } })

    const common = {
      tenant: tenant.id,
      startsAt: '2027-06-12T15:00:00.000Z',
      timeZone: 'Europe/Lisbon',
      location: 'Quinta da Regaleira, Sintra',
      published: true,
      // A private wedding: not on the public events list.
      listed: false,
    }
    const wedding = await payload.create({
      collection: 'events',
      data: { ...common, title: `${PREFIX}Ana and João`, slug: `${PREFIX}wedding` },
    })
    const closed = await payload.create({
      collection: 'events',
      data: { ...common, title: `${PREFIX}Closed`, slug: `${PREFIX}closed`, rsvpOpen: false },
    })
    const guest = await payload.create({
      collection: 'event-guests',
      data: { event: wedding.id, name: 'Maria Silva', partySize: 2, language: 'en', rsvpStatus: 'pending' },
    })
    const closedGuest = await payload.create({
      collection: 'event-guests',
      data: { event: closed.id, name: 'Rui Costa', partySize: 1, language: 'en', rsvpStatus: 'pending' },
    })
    guestId = guest.id
    openToken = guest.inviteToken!
    closedToken = closedGuest.inviteToken!
  })

  test('a private event stays off the events list and its public page', async ({ page }) => {
    await page.goto(`${BASE}/en/events`)
    await expect(page.getByText(`${PREFIX}Ana and João`)).toHaveCount(0)
    const response = await page.goto(`${BASE}/en/events/${PREFIX}wedding`)
    expect(response?.status()).toBe(404)
  })

  test('a guest opens their invitation and replies for their party', async ({ page }) => {
    await page.goto(`${BASE}/en/invite/${openToken}`)
    await expect(page.getByRole('heading', { name: `${PREFIX}Ana and João`, level: 1 })).toBeVisible()
    await expect(page.getByText('Dear Maria Silva,')).toBeVisible()
    await expect(page.getByText('This invitation is for 2 people, you included.')).toBeVisible()

    await page.getByLabel('Yes, I will be there').check()
    await page.getByLabel('How many of you are coming?').selectOption('2')
    await page.getByLabel('Dietary needs or allergies (optional)').fill('One vegetarian')
    await page.getByRole('button', { name: 'Send reply' }).click()
    await expect(page.getByText('Thank you. We have your reply and look forward to seeing you.')).toBeVisible()

    const payload = await getPayload({ config })
    const saved = await payload.findByID({ collection: 'event-guests', id: guestId })
    expect(saved).toMatchObject({ rsvpStatus: 'attending', attendingCount: 2, dietaryNotes: 'One vegetarian' })

    // Coming back shows the answer and lets them change it.
    await page.reload()
    // Let the form hydrate before clicking, or the click submits it as a plain GET.
    await page.waitForLoadState('networkidle')
    await expect(page.getByText('Your reply: attending, 2 people.')).toBeVisible()
    await page.getByLabel('Sorry, I cannot come').check()
    await page.getByRole('button', { name: 'Update reply' }).click()
    await expect(page.getByText('Thank you for letting us know. You will be missed.')).toBeVisible()
  })

  test('the invitation works in the guest\'s language', async ({ page }) => {
    await page.goto(`${BASE}/es/invite/${openToken}`)
    await expect(page.getByText('Hola Maria Silva,')).toBeVisible()
  })

  test('closed replies show no form, and an unknown link shows nothing', async ({ page }) => {
    await page.goto(`${BASE}/en/invite/${closedToken}`)
    await expect(page.getByText('Replies are closed.')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Send reply' })).toHaveCount(0)

    const response = await page.goto(`${BASE}/en/invite/${'A'.repeat(32)}`)
    expect(response?.status()).toBe(404)
  })
})
