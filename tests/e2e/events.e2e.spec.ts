import { expect, test } from '@playwright/test'
import { getPayload } from 'payload'

import config from '../../src/payload.config.js'
import { testJpeg } from '../helpers/image'
import { E2E_TENANT, seedE2ETenant } from '../helpers/seedUser'

const BASE = 'http://localhost:3000'
const PREFIX = 'e2e-event-'

const ids = {
  open: { slug: `${PREFIX}open`, title: `${PREFIX}Open night`, guest: '' },
  draft: { slug: `${PREFIX}draft`, title: `${PREFIX}Draft night`, guest: '' },
  closed: { slug: `${PREFIX}closed`, title: `${PREFIX}Closed night`, guest: '' },
}
let albumToken = ''

test.describe('Events and guest albums', () => {
  test.beforeAll(async () => {
    await seedE2ETenant()
    const payload = await getPayload({ config })
    const { docs } = await payload.find({ collection: 'tenants', where: { slug: { equals: E2E_TENANT.slug } } })
    const tenant = docs[0]!
    await payload.delete({ collection: 'events', where: { slug: { like: PREFIX } } })
    await payload.delete({ collection: 'gallery-photos', where: { filename: { like: PREFIX } } })
    await payload.delete({ collection: 'galleries', where: { slug: { like: PREFIX } } })

    const album = await payload.create({
      collection: 'galleries',
      data: { tenant: tenant.id, title: `${PREFIX}album`, slug: `${PREFIX}album`, status: 'published', shareEnabled: true },
    })
    albumToken = album.shareToken!
    await payload.create({ collection: 'gallery-photos', data: { gallery: album.id }, file: await testJpeg(`${PREFIX}photo.jpg`) })
    const closedAlbum = await payload.create({
      collection: 'galleries',
      data: { tenant: tenant.id, title: `${PREFIX}private`, slug: `${PREFIX}private`, status: 'published', shareEnabled: false },
    })

    const common = {
      tenant: tenant.id,
      startsAt: '2026-11-14T18:00:00.000Z',
      endsAt: '2026-11-14T23:30:00.000Z',
      timeZone: 'Europe/Lisbon',
      location: 'Sintra',
      summary: 'Films screened for guests, then dinner.',
      livestreamUrl: 'https://vimeo.com/76979871',
    }
    const open = await payload.create({
      collection: 'events',
      data: { ...common, title: ids.open.title, slug: ids.open.slug, published: true, gallery: album.id },
    })
    await payload.create({
      collection: 'events',
      data: { ...common, title: ids.draft.title, slug: ids.draft.slug, published: false, gallery: album.id },
    })
    const closed = await payload.create({
      collection: 'events',
      data: { ...common, title: ids.closed.title, slug: ids.closed.slug, published: true, gallery: closedAlbum.id },
    })
    ids.open.guest = open.guestToken!
    ids.closed.guest = closed.guestToken!
    ids.draft.guest = (
      await payload.find({ collection: 'events', where: { slug: { equals: ids.draft.slug } }, overrideAccess: true })
    ).docs[0]!.guestToken!
  })

  test('the events list shows only published events', async ({ page }) => {
    await page.goto(`${BASE}/en/events`)
    await expect(page.getByRole('heading', { name: 'Events', level: 1 })).toBeVisible()
    await expect(page.getByRole('link', { name: new RegExp(ids.open.title) })).toBeVisible()
    await expect(page.getByText(ids.draft.title)).toHaveCount(0)
  })

  test('an event page shows when and where, and its live stream', async ({ page }) => {
    await page.goto(`${BASE}/en/events/${ids.open.slug}`)
    await expect(page.getByRole('heading', { name: ids.open.title, level: 1 })).toBeVisible()
    await expect(page.getByText('Sintra')).toBeVisible()
    await expect(page.getByText('Films screened for guests, then dinner.')).toBeVisible()
    await expect(page.locator('iframe[title="' + ids.open.title + '"]')).toHaveAttribute(
      'src',
      'https://player.vimeo.com/video/76979871?dnt=1',
    )
  })

  test('an unpublished event is not found', async ({ page }) => {
    expect((await page.goto(`${BASE}/en/events/${ids.draft.slug}`))?.status()).toBe(404)
  })

  test('the guest link opens the event album', async ({ page }) => {
    await page.goto(`${BASE}/en/events/${ids.open.slug}/guests/${ids.open.guest}`)
    await expect(page).toHaveURL(new RegExp(`/s/${albumToken}$`))
  })

  test('a wrong or unpublished guest link is not found', async ({ page }) => {
    expect((await page.goto(`${BASE}/en/events/${ids.open.slug}/guests/${'x'.repeat(32)}`))?.status()).toBe(404)
    expect((await page.goto(`${BASE}/en/events/${ids.draft.slug}/guests/${ids.draft.guest}`))?.status()).toBe(404)
  })

  test('a guest link to an album that is not shared says so, and keeps the album hidden', async ({ page }) => {
    await page.goto(`${BASE}/en/events/${ids.closed.slug}/guests/${ids.closed.guest}`)
    await expect(page.getByText('The album is not available yet.')).toBeVisible()
    expect(page.url()).not.toContain('/s/')
  })

  test('guest links are kept out of referrers and search engines', async ({ request }) => {
    const response = await request.get(`${BASE}/en/events/${ids.open.slug}/guests/${ids.open.guest}`, {
      maxRedirects: 0,
    })
    expect(response.headers()['referrer-policy']).toBe('no-referrer')
    expect(response.headers()['x-robots-tag']).toBe('noindex')
  })
})
