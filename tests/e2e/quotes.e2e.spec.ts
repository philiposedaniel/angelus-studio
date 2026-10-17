import { expect, test } from '@playwright/test'
import { getPayload } from 'payload'

import config from '../../src/payload.config.js'
import { waitForHydration } from '../helpers/hydration'
import { E2E_TENANT, seedE2ETenant } from '../helpers/seedUser'

const BASE = 'http://localhost:3000'
const PREFIX = 'e2e-quote-'

test.describe('Client quotes', () => {
  let sentToken = ''
  let paidToken = ''
  let contractToken = ''
  let contractQuoteId = 0
  let draftToken = ''

  test.beforeAll(async () => {
    await seedE2ETenant()
    const payload = await getPayload({ config })
    const { docs } = await payload.find({ collection: 'tenants', where: { slug: { equals: E2E_TENANT.slug } } })
    const tenant = docs[0]!
    await payload.delete({ collection: 'quotes', where: { title: { like: PREFIX } } })

    const base = {
      tenant: tenant.id,
      clientName: 'Ana Ferreira',
      clientEmail: `${PREFIX}ana@example.com`,
      currency: 'eur' as const,
      lineItems: [
        { description: 'Wedding photography, full day', quantity: 1, unitAmount: 120000 },
        { description: 'Extra hour', quantity: 2, unitAmount: 5000 },
      ],
      depositPercent: 30,
    }
    const sent = await payload.create({
      collection: 'quotes',
      data: { ...base, title: `${PREFIX}sent`, status: 'sent' },
      overrideAccess: true,
    })
    const paid = await payload.create({
      collection: 'quotes',
      data: { ...base, title: `${PREFIX}paid`, status: 'sent' },
      overrideAccess: true,
    })
    await payload.update({
      collection: 'quotes',
      id: paid.id,
      data: { status: 'deposit-paid' },
      context: { stripePayment: true },
      overrideAccess: true,
    })
    const draft = await payload.create({
      collection: 'quotes',
      data: { ...base, title: `${PREFIX}draft`, status: 'draft' },
      overrideAccess: true,
    })
    sentToken = sent.publicToken!
    paidToken = paid.publicToken!
    draftToken = draft.publicToken!
    const withContract = await payload.create({
      collection: 'quotes',
      data: {
        ...base,
        title: `${PREFIX}contract`,
        status: 'sent',
        contract: { terms: 'The photographer arrives at 08:00 and stays until the last dance.' },
      },
      overrideAccess: true,
    })
    contractToken = withContract.publicToken!
    contractQuoteId = withContract.id
  })

  test('a sent quote shows its total and deposit, and says online payment is not set up here', async ({ page }) => {
    await page.goto(`${BASE}/en/quote/${sentToken}`)
    await expect(page.getByRole('heading', { name: `${PREFIX}sent`, level: 1 })).toBeVisible()
    await expect(page.getByText('Wedding photography, full day')).toBeVisible()
    // 1,200.00 + 2 x 50.00 = 1,300.00; 30% deposit = 390.00
    await expect(page.getByText('€1,300.00').first()).toBeVisible()
    await expect(page.getByText('€390.00')).toBeVisible()
    await expect(page.getByText('€910.00')).toBeVisible()
    // Without Stripe keys the page offers no payment button at all.
    await expect(page.getByRole('button', { name: /Pay deposit/ })).toHaveCount(0)
    await expect(page.getByText('Online payment is not available yet')).toBeVisible()
  })

  test('a paid quote says the deposit was received', async ({ page }) => {
    await page.goto(`${BASE}/en/quote/${paidToken}`)
    await expect(page.getByText('The deposit has been received. Thank you.')).toBeVisible()
    await expect(page.getByRole('button', { name: /Pay deposit/ })).toHaveCount(0)
  })

  test('drafts and unknown links are not found', async ({ page }) => {
    expect((await page.goto(`${BASE}/en/quote/${draftToken}`))?.status()).toBe(404)
    expect((await page.goto(`${BASE}/en/quote/${'x'.repeat(32)}`))?.status()).toBe(404)
  })

  test('the quote link is kept out of search engines and referrers', async ({ request }) => {
    const response = await request.get(`${BASE}/en/quote/${sentToken}`)
    expect(response.headers()['x-robots-tag']).toBe('noindex')
    expect(response.headers()['referrer-policy']).toBe('no-referrer')
  })

  test('the client reads the contract and signs it, and the signature is shown back', async ({ page }) => {
    await page.goto(`${BASE}/en/quote/${contractToken}`)
    await expect(page.getByRole('heading', { name: 'Contract', level: 2, exact: true })).toBeVisible()
    await expect(page.getByText('The photographer arrives at 08:00 and stays until the last dance.')).toBeVisible()
    await waitForHydration(page)

    await page.getByLabel('Your full name (this is your signature)').fill('  Ana   Ferreira ')
    await page.getByLabel('I have read the contract above and agree to it.').check()
    await page.getByRole('button', { name: 'Sign the contract' }).click()

    await expect(page.getByText(/Signed by Ana Ferreira/)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Sign the contract' })).toHaveCount(0)
    // Still no payment button here: Stripe is not set up in tests.
    await expect(page.getByRole('button', { name: /Pay deposit/ })).toHaveCount(0)

    const payload = await getPayload({ config })
    const saved = await payload.findByID({ collection: 'quotes', id: contractQuoteId, overrideAccess: true })
    expect(saved.contract?.signedName).toBe('Ana Ferreira')
    expect(saved.contract?.signedAt).toBeTruthy()
    expect(saved.contract?.termsFingerprint).toMatch(/^[0-9a-f]{64}$/)
  })
})
