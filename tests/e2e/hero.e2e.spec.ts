import { expect, test } from '@playwright/test'
import { getPayload } from 'payload'

import config from '../../src/payload.config.js'
import { testJpeg } from '../helpers/image'
import { E2E_TENANT, seedE2ETenant } from '../helpers/seedUser'

const BASE = 'http://localhost:3000'
const PREFIX = 'e2e-hero-'
const alt = 'Hero test photograph'

test.describe('Homepage hero image', () => {
  let mediaId: number
  let siteSettingsId: number | null = null
  let tenantId: number

  test.beforeAll(async () => {
    await seedE2ETenant()
    const payload = await getPayload({ config })
    const { docs } = await payload.find({ collection: 'tenants', where: { slug: { equals: E2E_TENANT.slug } } })
    tenantId = docs[0]!.id
    const media = await payload.create({
      collection: 'media',
      data: { tenant: tenantId, alt },
      file: await testJpeg(`${PREFIX}hero.jpg`),
      overrideAccess: true,
    })
    mediaId = media.id
    const settings = await payload.find({
      collection: 'site-settings',
      where: { tenant: { equals: tenantId } },
      limit: 1,
      depth: 0,
      overrideAccess: true,
    })
    siteSettingsId = settings.docs[0]?.id ?? null
    if (siteSettingsId) {
      await payload.update({
        collection: 'site-settings',
        id: siteSettingsId,
        data: { heroImage: mediaId },
        overrideAccess: true,
      })
    } else {
      const created = await payload.create({
        collection: 'site-settings',
        data: { tenant: tenantId, companyName: 'Angelus Media Productions', heroImage: mediaId },
        overrideAccess: true,
      })
      siteSettingsId = created.id
    }
  })

  test.afterAll(async () => {
    const payload = await getPayload({ config })
    if (siteSettingsId) {
      await payload.update({ collection: 'site-settings', id: siteSettingsId, data: { heroImage: null }, overrideAccess: true })
    }
    await payload.delete({ collection: 'media', where: { id: { equals: mediaId } }, overrideAccess: true })
  })

  test('the hero photo loads when the site sets a server URL, as it does in production', async ({ page }) => {
    await page.goto(`${BASE}/en`)
    const hero = page.locator(`img[alt="${alt}"]`)
    await expect(hero).toBeVisible()
    // next/image would reject an absolute media URL and the photo would never decode.
    await expect
      .poll(() => hero.evaluate((img: HTMLImageElement) => img.naturalWidth))
      .toBeGreaterThan(0)
  })
})
