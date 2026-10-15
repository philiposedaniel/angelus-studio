import { expect, test } from '@playwright/test'
import { getPayload } from 'payload'

import config from '../../src/payload.config.js'
import { testJpeg } from '../helpers/image'
import { E2E_TENANT, seedE2ETenant } from '../helpers/seedUser'

const BASE = 'http://localhost:3000'
const PREFIX = 'e2e-page-'

const paragraph = (text: string) => ({
  root: {
    type: 'root',
    format: '',
    indent: 0,
    version: 1,
    direction: 'ltr',
    children: [
      {
        type: 'paragraph',
        format: '',
        indent: 0,
        version: 1,
        direction: 'ltr',
        textFormat: 0,
        children: [{ type: 'text', text, format: 0, detail: 0, mode: 'normal', style: '', version: 1 }],
      },
    ],
  },
})

// The pasted code reports whether it can reach the page around it.
const PROBE = `<p id="probe"></p><script>
  let reach = 'isolated'
  try { parent.document.title; reach = 'not isolated' } catch (e) {}
  try { document.cookie; } catch (e) {}
  document.getElementById('probe').textContent = reach
</script>`

test.describe('Website pages', () => {
  test.beforeAll(async () => {
    await seedE2ETenant()
    const payload = await getPayload({ config })
    const { docs } = await payload.find({ collection: 'tenants', where: { slug: { equals: E2E_TENANT.slug } } })
    const tenant = docs[0]!
    await payload.delete({ collection: 'pages', where: { slug: { like: PREFIX } } })
    await payload.delete({ collection: 'gallery-photos', where: { filename: { like: PREFIX } } })
    await payload.delete({ collection: 'galleries', where: { slug: { like: PREFIX } } })

    const gallery = await payload.create({
      collection: 'galleries',
      data: { tenant: tenant.id, title: 'Studio picks', slug: `${PREFIX}picks`, status: 'published', shareEnabled: true },
    })
    await payload.create({
      collection: 'gallery-photos',
      data: { gallery: gallery.id },
      file: await testJpeg(`${PREFIX}pick.jpg`),
    })

    await payload.create({
      collection: 'pages',
      data: {
        tenant: tenant.id,
        title: 'Our work',
        slug: `${PREFIX}work`,
        intro: 'Films and photographs from recent productions.',
        published: true,
        showInMenu: true,
        layout: [
          { blockType: 'text', content: paragraph('A few favourite projects.') as never },
          { blockType: 'video', url: 'https://vimeo.com/76979871', aspect: '16/9', caption: 'Showreel' },
          { blockType: 'embedCode', code: PROBE, title: 'Pasted embed', size: 'fixed', height: 200 },
          { blockType: 'googlePhotos', url: 'https://photos.app.goo.gl/AbCdEf123', title: 'Lisbon wedding' },
          { blockType: 'sharedAlbum', gallery: gallery.id },
        ],
      },
    })
    await payload.create({
      collection: 'pages',
      data: { tenant: tenant.id, title: 'Hidden draft', slug: `${PREFIX}draft`, published: false },
    })
  })

  test('a page built in the admin shows its blocks and appears in the menu', async ({ page }) => {
    await page.goto(`${BASE}/en`)
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Our work' }).click()
    await expect(page).toHaveURL(new RegExp(`/en/${PREFIX}work$`))
    await expect(page.getByRole('heading', { name: 'Our work', level: 1 })).toBeVisible()
    await expect(page.getByText('A few favourite projects.')).toBeVisible()

    await expect(page.locator('iframe[title="Showreel"]')).toHaveAttribute(
      'src',
      'https://player.vimeo.com/video/76979871?dnt=1',
    )

    const card = page.getByRole('link', { name: /Lisbon wedding/ })
    await expect(card).toHaveAttribute('href', 'https://photos.app.goo.gl/AbCdEf123')
    await expect(card).toHaveAttribute('target', '_blank')

    await expect(page.getByRole('button', { name: /Open photo/ })).toHaveCount(1)
    await expect(page.getByRole('link', { name: 'Open the full album (1)' })).toHaveAttribute('href', /^\/s\//)
  })

  test('pasted embed code runs, but cannot reach the website around it', async ({ page }) => {
    await page.goto(`${BASE}/en/${PREFIX}work`)
    const embed = page.locator('iframe[title="Pasted embed"]')
    await expect(embed).toHaveAttribute('sandbox', /allow-scripts/)
    await expect(embed).not.toHaveAttribute('sandbox', /allow-same-origin/)
    await expect(page.frameLocator('iframe[title="Pasted embed"]').locator('#probe')).toHaveText('isolated')
  })

  test('unpublished pages are not found', async ({ page }) => {
    const response = await page.goto(`${BASE}/en/${PREFIX}draft`)
    expect(response?.status()).toBe(404)
  })
})
