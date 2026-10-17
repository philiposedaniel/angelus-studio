import fs from 'fs'
import path from 'path'

import { expect, test } from '@playwright/test'
import sharp from 'sharp'
import { getPayload } from 'payload'

import config from '../../src/payload.config.js'
import { GALLERY_PHOTOS_DIR } from '../../src/lib/storage'
import { testJpeg } from '../helpers/image'
import { E2E_TENANT, seedE2ETenant } from '../helpers/seedUser'

const BASE = 'http://localhost:3000'
const PREFIX = 'e2e-watermark-'
const password = 'e2e-Password-1'
const client = { email: `${PREFIX}client@angelus.test`, password }

type Seeded = {
  marked: { token: string; photoId: number; web: string; thumb: string }
  clean: { token: string; photoId: number; web: string; thumb: string }
}
let seeded: Seeded

const storedBytes = (filename: string) => fs.promises.readFile(path.join(GALLERY_PHOTOS_DIR, filename))

async function seed(): Promise<Seeded> {
  await seedE2ETenant()
  const payload = await getPayload({ config })
  const { docs } = await payload.find({ collection: 'tenants', where: { slug: { equals: E2E_TENANT.slug } } })
  const tenant = docs[0]!
  await payload.delete({ collection: 'gallery-photos', where: { filename: { like: PREFIX } } })
  await payload.delete({ collection: 'galleries', where: { slug: { like: PREFIX } } })
  await payload.delete({ collection: 'users', where: { email: { like: PREFIX } } })

  const user = await payload.create({
    collection: 'users',
    data: { ...client, roles: ['user'], tenants: [{ tenant: tenant.id, roles: ['client'] }] },
  })

  const make = async (slug: string, watermarkText: string | undefined) => {
    const gallery = await payload.create({
      collection: 'galleries',
      data: {
        tenant: tenant.id,
        title: slug,
        slug: `${PREFIX}${slug}`,
        status: 'published',
        clients: [user.id],
        allowDownloads: false,
        shareEnabled: true,
        watermarkText,
      },
    })
    const photo = await payload.create({
      collection: 'gallery-photos',
      data: { gallery: gallery.id },
      file: await testJpeg(`${PREFIX}${slug}.jpg`),
    })
    return {
      token: gallery.shareToken!,
      photoId: photo.id,
      web: photo.sizes!.web!.filename!,
      thumb: photo.sizes!.thumbnail!.filename!,
    }
  }
  return {
    marked: await make('marked', 'Angelus Media'),
    clean: await make('clean', undefined),
  }
}

test.describe('Watermarks on preview copies', () => {
  test.beforeAll(async () => {
    seeded = await seed()
  })

  test('a shared album copy of a watermarked gallery is marked, and its stored copy is not', async ({ request }) => {
    const { marked } = seeded
    const response = await request.get(`${BASE}/s/${marked.token}/p/${marked.photoId}/web`)
    expect(response.status()).toBe(200)
    expect(response.headers()['content-type']).toBe('image/webp')
    const served = await response.body()
    const stored = await storedBytes(marked.web)
    expect(served.equals(stored)).toBe(false)

    const meta = await sharp(served).metadata()
    const original = await sharp(stored).metadata()
    expect(meta.width).toBe(original.width)
    expect(meta.height).toBe(original.height)
    // The original file on disk is never changed.
    expect((await storedBytes(marked.web)).equals(stored)).toBe(true)
  })

  test('a gallery without a watermark is served exactly as stored', async ({ request }) => {
    const { clean } = seeded
    const response = await request.get(`${BASE}/s/${clean.token}/p/${clean.photoId}/web`)
    expect(response.status()).toBe(200)
    expect((await response.body()).equals(await storedBytes(clean.web))).toBe(true)
  })

  test('a client in the portal sees the watermarked copy, not the stored one', async ({ page }) => {
    const { marked } = seeded
    // Sign in through the portal form, so the browser session carries the client's cookie.
    await page.goto(`${BASE}/en/portal/login`)
    // Let the form hydrate first, or the dev server's reload can wipe what was typed.
    await page.waitForLoadState('networkidle')
    await page.getByLabel('Email').fill(client.email)
    await page.getByLabel('Password').fill(client.password)
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page).toHaveURL(/\/en\/portal$/, { timeout: 20_000 })

    // Fetch the thumbnail the way the gallery page does: from the browser's own session.
    await page.goto(`${BASE}/en/portal/galleries/${PREFIX}marked`)
    const src = await page.locator('img').first().getAttribute('src')
    expect(src).toContain(`/api/gallery-photos/file/`)
    const served = await page.evaluate(async (url) => {
      const res = await fetch(url, { credentials: 'include' })
      if (!res.ok) return null
      return Array.from(new Uint8Array(await res.arrayBuffer()))
    }, new URL(src!, BASE).toString())
    expect(served).not.toBeNull()
    expect(Buffer.from(served!).equals(await storedBytes(marked.thumb))).toBe(false)
  })
})
