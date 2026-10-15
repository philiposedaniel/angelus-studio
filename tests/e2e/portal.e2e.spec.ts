import { expect, test, type Page } from '@playwright/test'
import { getPayload } from 'payload'

import config from '../../src/payload.config.js'
import { testJpeg } from '../helpers/image'
import { E2E_TENANT, seedE2ETenant } from '../helpers/seedUser'

const BASE = 'http://localhost:3000'
const PREFIX = 'e2e-portal-'
const password = 'e2e-Password-1'
const clientA = { email: `${PREFIX}a@angelus.test`, password }
const clientB = { email: `${PREFIX}b@angelus.test`, password }

type Seeded = { originalUrl: string; thumbUrl: string }
let seeded: Seeded

async function seed(): Promise<Seeded> {
  await seedE2ETenant()
  const payload = await getPayload({ config })
  const { docs } = await payload.find({ collection: 'tenants', where: { slug: { equals: E2E_TENANT.slug } } })
  const tenant = docs[0]!
  await payload.delete({ collection: 'gallery-favorites', where: { 'gallery.slug': { like: PREFIX } } })
  await payload.delete({ collection: 'gallery-photos', where: { filename: { like: PREFIX } } })
  await payload.delete({ collection: 'galleries', where: { slug: { like: PREFIX } } })
  await payload.delete({ collection: 'users', where: { email: { like: PREFIX } } })

  const makeClient = (data: typeof clientA) =>
    payload.create({
      collection: 'users',
      data: { ...data, roles: ['user'], tenants: [{ tenant: tenant.id, roles: ['client'] }] },
    })
  const a = await makeClient(clientA)
  await makeClient(clientB)

  const gallery = await payload.create({
    collection: 'galleries',
    data: {
      tenant: tenant.id,
      title: 'Smith wedding',
      slug: `${PREFIX}smith-wedding`,
      status: 'published',
      clients: [a.id],
      allowDownloads: false,
    },
  })
  const photo = await payload.create({
    collection: 'gallery-photos',
    data: { gallery: gallery.id },
    file: await testJpeg(`${PREFIX}first-dance.jpg`),
  })
  return { originalUrl: photo.url!, thumbUrl: photo.sizes!.thumbnail!.url! }
}

/** Signs in through the login form, so later requests carry the browser's session cookie. */
const signIn = async (page: Page, user: typeof clientA) => {
  await page.goto(`${BASE}/en/portal/login`)
  await page.getByLabel('Email').fill(user.email)
  await page.getByLabel('Password').fill(user.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/en\/portal$/)
}

/** Opens a file URL as a browser navigation and returns the HTTP status. */
const openFile = async (page: Page, url: string) =>
  (await page.goto(new URL(url, BASE).href))?.status()

test.describe('Client portal', () => {
  test.beforeAll(async () => {
    seeded = await seed()
  })

  test('a client signs in, sees their gallery and saves a favorite', async ({ page }) => {
    await page.goto(`${BASE}/en/portal`)
    await expect(page).toHaveURL(/\/en\/portal\/login$/)
    await signIn(page, clientA)
    await page.getByRole('link', { name: /Smith wedding/ }).click()
    await expect(page.getByRole('heading', { name: 'Smith wedding' })).toBeVisible()
    // The thumbnail actually loads with the client's session.
    await expect
      .poll(() => page.locator('main li img').first().evaluate((img: HTMLImageElement) => img.naturalWidth))
      .toBeGreaterThan(0)

    await page.getByRole('button', { name: 'Add to favorites' }).click()
    await expect(page.getByRole('button', { name: 'Remove from favorites' })).toBeVisible()
    await page.reload()
    await expect(page.getByRole('link', { name: 'Favorites (1)' })).toBeVisible()

    // Downloads are switched off for this gallery, so no download link is offered.
    await expect(page.getByRole('link', { name: 'Download full resolution' })).toHaveCount(0)
  })

  test('another client cannot see the gallery or its files', async ({ page }) => {
    await signIn(page, clientB)
    await expect(page.getByText('You have no galleries yet')).toBeVisible()

    const gallery = await page.goto(`${BASE}/en/portal/galleries/${PREFIX}smith-wedding`)
    expect(gallery?.status()).toBe(404)
    expect(await openFile(page, seeded.thumbUrl)).toBe(403)
  })

  test('private files are refused without signing in', async ({ page }) => {
    expect(await openFile(page, seeded.thumbUrl)).toBe(403)
    expect(await openFile(page, seeded.originalUrl)).toBe(403)
  })

  test('the assigned client can view copies but not the original when downloads are off', async ({
    page,
  }) => {
    await signIn(page, clientA)
    expect(await openFile(page, seeded.thumbUrl)).toBe(200)
    expect(await openFile(page, seeded.originalUrl)).toBe(403)
  })
})
