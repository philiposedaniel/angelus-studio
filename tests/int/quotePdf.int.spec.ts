import { getPayload, type Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { loadQuotePdf } from '@/lib/quotePdf'
import config from '@/payload.config'
import type { Tenant } from '@/payload-types'

import { ensureTenant } from '../helpers/seedTenant'

const PREFIX = 'int-quote-pdf-'

let payload: Payload
let studioA: Tenant
let studioB: Tenant

const cleanup = async () => {
  await payload.delete({ collection: 'quotes', where: { title: { like: PREFIX } }, overrideAccess: true })
}

const makeQuote = (tenant: Tenant, title: string, status: 'sent' | 'draft') =>
  payload.create({
    collection: 'quotes',
    data: {
      tenant: tenant.id,
      title: `${PREFIX}${title}`,
      clientName: 'Maria Silva',
      clientEmail: 'maria@example.test',
      currency: 'eur',
      lineItems: [{ description: 'Wedding photography', quantity: 1, unitAmount: 100000 }],
      depositPercent: 30,
      status,
    },
    overrideAccess: true,
  })

describe('quote PDF download', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    studioA = await ensureTenant(payload, { name: 'Int Quote PDF A', slug: 'int-quote-pdf-a' })
    studioB = await ensureTenant(payload, { name: 'Int Quote PDF B', slug: 'int-quote-pdf-b' })
    await cleanup()
  })

  afterAll(cleanup)

  it('makes a PDF for a sent quote, through its private link, in the studio’s own language', async () => {
    const quote = await makeQuote(studioA, 'sent', 'sent')
    const file = await loadQuotePdf(payload, studioA.id, quote.publicToken as string, 'es')
    expect(file).not.toBeNull()
    expect(file?.filename).toBe(`quote-${quote.id}.pdf`)
    expect(Buffer.from(file!.bytes.slice(0, 5)).toString('latin1')).toBe('%PDF-')
  })

  it('finds nothing with another studio’s link, so no PDF of their quote is made', async () => {
    const quote = await makeQuote(studioA, 'other-studio', 'sent')
    expect(await loadQuotePdf(payload, studioB.id, quote.publicToken as string, 'en')).toBeNull()
  })

  it('makes no PDF for a draft quote, even with its link', async () => {
    const draft = await makeQuote(studioA, 'draft', 'draft')
    expect(await loadQuotePdf(payload, studioA.id, draft.publicToken as string, 'en')).toBeNull()
  })
})
