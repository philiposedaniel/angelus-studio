import { getPayload, type Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { websiteSitemapEntries } from '@/lib/seo'
import config from '@/payload.config'
import type { Tenant } from '@/payload-types'

import { ensureTenant } from '../helpers/seedTenant'

const PREFIX = 'int-seo-'

let payload: Payload
let studioA: Tenant
let studioB: Tenant

const cleanup = async () => {
  await payload.delete({ collection: 'pages', where: { slug: { like: PREFIX } } })
}

const urlsOf = async (tenant: Tenant) =>
  (await websiteSitemapEntries(payload, tenant)).map((entry) => entry.url)

describe('sitemap for the public website', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    studioA = await ensureTenant(payload, {
      name: 'Int SEO Studio A',
      slug: 'int-seo-studio-a',
      domain: 'seo-a.angelus.test',
      languages: ['en', 'es'],
    })
    studioB = await ensureTenant(payload, {
      name: 'Int SEO Studio B',
      slug: 'int-seo-studio-b',
      domain: 'seo-b.angelus.test',
      languages: ['en'],
    })
    await cleanup()
    await payload.create({
      collection: 'pages',
      data: { tenant: studioA.id, title: 'About', slug: `${PREFIX}about`, published: true },
    })
    await payload.create({
      collection: 'pages',
      data: { tenant: studioA.id, title: 'Draft', slug: `${PREFIX}draft`, published: false },
    })
    await payload.create({
      collection: 'pages',
      data: { tenant: studioB.id, title: 'Other', slug: `${PREFIX}other`, published: true },
    })
  })

  afterAll(async () => {
    await cleanup()
  })

  it("lists the studio's published pages in each language it offers, and the home page", async () => {
    const urls = await urlsOf(studioA)
    expect(urls).toEqual(
      expect.arrayContaining([
        'https://seo-a.angelus.test/en',
        'https://seo-a.angelus.test/es',
        `https://seo-a.angelus.test/en/${PREFIX}about`,
        `https://seo-a.angelus.test/es/${PREFIX}about`,
      ]),
    )
  })

  it('never lists unpublished pages or another studio’s pages, even with the same kind of slug', async () => {
    const urls = (await urlsOf(studioA)).join('\n')
    expect(urls).not.toContain(`${PREFIX}draft`)
    expect(urls).not.toContain(`${PREFIX}other`)
    expect(urls).not.toContain('seo-b.angelus.test')
  })

  it('gives each page language alternates that point at the same page in every offered language', async () => {
    const entries = await websiteSitemapEntries(payload, studioA)
    const about = entries.find((entry) => entry.url === `https://seo-a.angelus.test/en/${PREFIX}about`)
    expect(about?.alternates?.languages).toEqual({
      en: `https://seo-a.angelus.test/en/${PREFIX}about`,
      es: `https://seo-a.angelus.test/es/${PREFIX}about`,
    })
  })

  it('lists nothing for a studio without a domain, since its URLs cannot be absolute', async () => {
    const withoutDomain = { ...studioA, domain: null } as Tenant
    expect(await websiteSitemapEntries(payload, withoutDomain)).toEqual([])
  })
})
