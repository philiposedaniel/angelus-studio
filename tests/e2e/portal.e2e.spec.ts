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
  const oldDownloads = await payload.find({
    collection: 'gallery-downloads',
    where: { 'gallery.slug': { like: PREFIX } },
    pagination: false,
    depth: 0,
  })
  await payload.delete({ collection: 'gallery-downloads', where: { id: { in: oldDownloads.docs.map((d) => d.id) } } })
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
  const delivered = await payload.create({
    collection: 'galleries',
    data: {
      tenant: tenant.id,
      title: 'Jones engagement',
      slug: `${PREFIX}jones-engagement`,
      status: 'published',
      clients: [a.id],
      allowDownloads: true,
    },
  })
  for (const name of ['ring', 'sunset']) {
    await payload.create({
      collection: 'gallery-photos',
      data: { gallery: delivered.id },
      file: await testJpeg(`${PREFIX}${name}.jpg`),
    })
  }
  return { originalUrl: photo.url!, thumbUrl: photo.sizes!.thumbnail!.url! }
}

/** Signs in through the login form, so later requests carry the browser's session cookie. */
const signIn = async (page: Page, user: typeof clientA) => {
  await page.goto(`${BASE}/en/portal/login`)
  // Let the form hydrate first, or the dev server's reload can wipe what was typed.
  await page.waitForLoadState('networkidle')
  await page.getByLabel('Email').fill(user.email)
  await page.getByLabel('Password').fill(user.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  // The first sign-in can wait on the dev server compiling the route.
  await expect(page).toHaveURL(/\/en\/portal$/, { timeout: 20_000 })
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

  test('a client downloads a whole gallery as one ZIP', async ({ page }) => {
    await signIn(page, clientA)
    await page.getByRole('link', { name: /Jones engagement/ }).click()
    await page.getByRole('button', { name: 'Download all as ZIP' }).click()
    await expect(page.getByRole('button', { name: 'Preparing your download…' })).toBeVisible()

    // The ZIP is built by the server's background job, which runs every few seconds.
    const ready = page.getByRole('link', { name: 'Your ZIP is ready: download it' })
    await expect(ready).toBeVisible({ timeout: 30_000 })
    const [download] = await Promise.all([page.waitForEvent('download'), ready.click()])
    expect(download.suggestedFilename()).toBe(`${PREFIX}jones-engagement.zip`)
    const zip = await download.createReadStream().then(async (stream) => {
      const chunks: Buffer[] = []
      for await (const chunk of stream) chunks.push(chunk as Buffer)
      return Buffer.concat(chunks)
    })
    expect(zip.subarray(0, 2).toString()).toBe('PK')
  })

  test('another client cannot fetch someone else’s ZIP', async ({ page }) => {
    const payload = await getPayload({ config })
    const { docs } = await payload.find({
      collection: 'gallery-downloads',
      where: { 'gallery.slug': { equals: `${PREFIX}jones-engagement` } },
      limit: 1,
      depth: 0,
    })
    test.skip(!docs[0], 'needs the ZIP from the previous test')
    await signIn(page, clientB)
    expect(await openFile(page, `/api/gallery-downloads/${docs[0]!.id}/file`)).toBe(404)
  })
})
