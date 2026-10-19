import { expect, test } from '@playwright/test'
import { getPayload } from 'payload'

import config from '../../src/payload.config.js'
import { waitForHydration } from '../helpers/hydration'
import { login } from '../helpers/login'
import { E2E_TENANT, seedTestUser, testUser } from '../helpers/seedUser'

const BASE = 'http://localhost:3000'
const PREFIX = 'e2e-invite-'

let openToken = ''
let closedToken = ''
let guestId: number
let weddingId: number

test.describe('Invitations and RSVP', () => {
  test.beforeAll(async () => {
    // Seeds the studio and a studio administrator, who checks guests in.
    await seedTestUser()
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
      data: {
        ...common,
        title: `${PREFIX}Ana and João`,
        slug: `${PREFIX}wedding`,
        invitation: {
          style: 'garden',
          headline: 'Together with their families',
          schedule: [{ time: '16:00', title: 'Ceremony', place: 'The chapel' }],
          dressCode: 'Garden formal',
        },
        mealOptions: [{ label: 'Fish' }, { label: 'Vegetarian' }],
      },
    })
    weddingId = wedding.id
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
    // The design chosen on the event.
    await expect(page.getByText('Together with their families')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Programme' })).toBeVisible()
    await expect(page.getByText('Ceremony')).toBeVisible()
    await expect(page.getByText('Garden formal')).toBeVisible()
    await waitForHydration(page)

    await page.getByLabel('Yes, I will be there').check()
    await page.getByLabel('How many of you are coming?').selectOption('2')
    // Each person coming picks a meal; a meal is needed for everyone.
    await page.getByLabel('Your meal').selectOption({ label: 'Fish' })
    await page.getByLabel('Name of guest 2 (optional)').fill('Pedro Silva')
    await page.getByRole('button', { name: 'Send reply' }).click()
    await expect(page.getByText('Please choose a meal.')).toBeVisible()
    await page.getByLabel('Their meal').selectOption({ label: 'Vegetarian' })
    await page.getByLabel('Dietary needs or allergies (optional)').fill('No nuts')
    await page.getByRole('button', { name: 'Send reply' }).click()
    await expect(page.getByText('Thank you. We have your reply and look forward to seeing you.')).toBeVisible()

    const payload = await getPayload({ config })
    const saved = await payload.findByID({ collection: 'event-guests', id: guestId })
    expect(saved).toMatchObject({ rsvpStatus: 'attending', attendingCount: 2, dietaryNotes: 'No nuts' })
    expect(saved.party?.map((person) => person.name)).toEqual(['Maria Silva', 'Pedro Silva'])

    // Coming back shows the answer and lets them change it.
    await page.reload()
    // Wait for the form to hydrate, or the click submits it as a plain GET.
    await expect(page.getByText('Your reply: attending, 2 people.')).toBeVisible()
    await waitForHydration(page)
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

  test('the entry code leads staff to check the guest in, and tells anyone else to show it', async ({ page }) => {
    const payload = await getPayload({ config })
    // The reply test above ended with a decline, and guests who decline get no entry code.
    const guest = await payload.findByID({ collection: 'event-guests', id: guestId, depth: 0 })
    const table = await payload.create({
      collection: 'event-tables',
      data: { event: guest.event as number, name: 'Head table', capacity: 8 },
    })
    await payload.update({
      collection: 'event-guests',
      id: guestId,
      data: { rsvpStatus: 'attending', attendingCount: 2, table: table.id },
    })
    const wedding = await payload.findByID({ collection: 'events', id: weddingId, depth: 0 })
    const [fish, vegetarian] = wedding.mealOptions!.map((option) => option.id!)
    await payload.update({
      collection: 'event-guests',
      id: guestId,
      data: { party: [{ name: 'Maria Silva', meal: fish }, { name: 'Pedro Silva', meal: vegetarian }] },
    })
    await page.goto(`${BASE}/en/invite/${openToken}`)
    await expect(page.getByRole('img', { name: 'Your entry code' })).toBeVisible()

    await page.goto(`${BASE}/en/invite/${openToken}/check-in`)
    await expect(page.getByRole('heading', { name: 'Show this code at the entrance' })).toBeVisible()
    await expect(page.getByText('Maria Silva')).toHaveCount(0)
    await expect(page.getByText('Head table')).toHaveCount(0)

    // Staff sign in on the same site, then open the code.
    await login({ page, user: testUser })
    await page.goto(`${BASE}/en/invite/${openToken}/check-in`)
    await expect(page.getByRole('heading', { name: 'Maria Silva' })).toBeVisible()
    // The staff view says where the party sits.
    await expect(page.getByText('Table: Head table')).toBeVisible()
    // And who is coming, with their meals, for the kitchen.
    await expect(page.getByText('Maria Silva (Fish), Pedro Silva (Vegetarian)')).toBeVisible()
    await waitForHydration(page)
    await page.getByLabel('How many have arrived?').selectOption('2')
    await page.getByRole('button', { name: 'Check in' }).click()
    await expect(page.getByText('Checked in.')).toBeVisible()

    const saved = await payload.findByID({ collection: 'event-guests', id: guestId })
    expect(saved.checkedInCount).toBe(2)

    // In the admin, staff see each person's meal by name and can change it.
    await page.goto(`${BASE}/admin/collections/event-guests/${guestId}`)
    await expect(page.locator('input[name="party.1.name"]')).toHaveValue('Pedro Silva')
    await expect(page.getByText('Vegetarian', { exact: true })).toBeVisible()
  })

  test('staff preview the invitation design; nobody else can', async ({ page }) => {
    const anonymous = await page.goto(`${BASE}/en/invite/preview/${weddingId}`)
    expect(anonymous?.status()).toBe(404)

    await login({ page, user: testUser })
    await page.goto(`${BASE}/en/invite/preview/${weddingId}`)
    await expect(page.getByText('Preview for studio staff.', { exact: false })).toBeVisible()
    await expect(page.getByText('Together with their families')).toBeVisible()
    await expect(page.getByText('Dear Guest name,')).toBeVisible()
  })
})
