import type { Payload } from 'payload'

import type { Tenant } from '../../src/payload-types.js'

/** Finds or creates a studio plus its site settings, for tests and local seeding. */
export async function ensureTenant(
  payload: Payload,
  data: { name: string; slug: string; domain?: string; languages?: Tenant['languages'] },
): Promise<Tenant> {
  const existing = await payload.find({
    collection: 'tenants',
    where: { slug: { equals: data.slug } },
    limit: 1,
  })
  const found = existing.docs[0]
  const tenant = found
    ? data.languages
      ? await payload.update({ collection: 'tenants', id: found.id, data: { languages: data.languages } })
      : found
    : await payload.create({
        collection: 'tenants',
        data: { languages: ['en'], defaultLocale: 'en', ...data },
      })

  const settings = await payload.find({
    collection: 'site-settings',
    where: { tenant: { equals: tenant.id } },
    limit: 1,
  })
  if (settings.totalDocs === 0) {
    await payload.create({
      collection: 'site-settings',
      data: { tenant: tenant.id, companyName: data.name, tagline: 'Cinematic photography, film and live production.' },
    })
  }
  return tenant
}
