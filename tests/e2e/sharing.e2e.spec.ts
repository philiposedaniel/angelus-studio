import { expect, test } from '@playwright/test'
import { getPayload } from 'payload'

import config from '../../src/payload.config.js'
import { testJpeg } from '../helpers/image'
import { waitForHydration } from '../helpers/hydration'
import { E2E_TENANT, seedE2ETenant } from '../helpers/seedUser'

const BASE = 'http://localhost:3000'
const PREFIX = 'e2e-share-'

let token: string
let galleryId: number
let photoIds: number[]
let privatePhotoId: number

test.describe('Shared albums', () => {
  test.beforeAll(async () => {
    await seedE2ETenant()
    const payload = await getPayload({ config })
    const { docs } = await payload.find({ collection: 'tenants', where: { slug: { equals: E2E_TENANT.slug } } })
    const tenant = docs[0]!
    await payload.delete({ collection: 'gallery-photos', where: { filename: { like: PREFIX } } })
    await payload.delete({ collection: 'galleries', where: { slug: { like: PREFIX } } })

    const gallery = await payload.create({
      collection: 'galleries',
      data: { tenant: tenant.id, title: 'Garden party', slug: `${PREFIX}garden`, status: 'published', shareEnabled: true },
    })
    const unshared = await payload.create({
      collection: 'galleries',
      data: { tenant: tenant.id, title: 'Private', slug: `${PREFIX}private`, status: 'published' },
    })
    photoIds = []
    for (const name of ['arrival', 'toast']) {
      const photo = await payload.create({
        collection: 'gallery-photos',
        data: { gallery: gallery.id },
        file: await testJpeg(`${PREFIX}${name}.jpg`),
      })
      photoIds.push(photo.id)
    }
    privatePhotoId = (
      await payload.create({
        collection: 'gallery-photos',
        data: { gallery: unshared.id },
        file: await testJpeg(`${PREFIX}secret.jpg`),
      })
    ).id
    galleryId = gallery.id
    token = (await payload.findByID({ collection: 'galleries', id: gallery.id })).shareToken!
  })

  test('anyone with the link sees the album and flips through it full screen', async ({ page }) => {
    await page.goto(`${BASE}/s/${token}`)
    await expect(page.getByRole('heading', { name: 'Garden party' })).toBeVisible()
    await expect(page.getByText('2 photos')).toBeVisible()
    await expect
      .poll(() => page.locator('main li img').first().evaluate((img: HTMLImageElement) => img.naturalWidth))
      .toBeGreaterThan(0)
    await waitForHydration(page)

    await page.getByRole('button', { name: 'Open photo 1' }).click()
    const viewer = page.getByRole('dialog')
    await expect(viewer.getByText('1 of 2')).toBeVisible()
    await page.keyboard.press('ArrowRight')
    await expect(viewer.getByText('2 of 2')).toBeVisible()
    await page.keyboard.press('ArrowRight')
    await expect(viewer.getByText('1 of 2')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(viewer).toBeHidden()
  })

  test('serves only web-size copies of this album’s photos', async ({ page }) => {
    const status = async (path: string) => (await page.goto(`${BASE}${path}`))?.status()
    expect(await status(`/s/${token}/p/${photoIds[0]}/web`)).toBe(200)
    expect(await status(`/s/${token}/p/${photoIds[0]}/thumbnail`)).toBe(200)
    expect(await status(`/s/${token}/p/${photoIds[0]}/original`)).toBe(404)
    // A photo from another gallery cannot be reached through this link.
    expect(await status(`/s/${token}/p/${privatePhotoId}/web`)).toBe(404)
  })

  test('the album can be embedded in another website', async ({ page }) => {
    const embed = await page.goto(`${BASE}/s/${token}/embed`)
    expect(embed?.headers()['content-security-policy']).toBe('frame-ancestors *')
    // The full album page is not frameable by other sites.
    const album = await page.goto(`${BASE}/s/${token}`)
    expect(album?.headers()['x-frame-options']).toBe('SAMEORIGIN')
    expect(album?.headers()['content-security-policy']).toBeUndefined()

    await page.setContent(`<iframe src="${BASE}/s/${token}/embed" width="800" height="600"></iframe>`)
    const frame = page.frameLocator('iframe')
    // The iframe is a separate page load, so allow it longer than the default wait.
    await expect(frame.getByRole('link', { name: 'Garden party' })).toBeVisible({ timeout: 15_000 })
    await expect(frame.getByRole('button', { name: /Open photo/ })).toHaveCount(2, { timeout: 15_000 })
  })

  test('turning sharing off stops the link working', async ({ page }) => {
    const payload = await getPayload({ config })
    await payload.update({ collection: 'galleries', id: galleryId, data: { shareEnabled: false } })
    const response = await page.goto(`${BASE}/s/${token}`)
    expect(response?.status()).toBe(404)
    await expect(page.getByRole('heading', { name: 'This album is not available' })).toBeVisible()
    expect((await page.goto(`${BASE}/s/${token}/p/${photoIds[0]}/web`))?.status()).toBe(404)
  })
})
