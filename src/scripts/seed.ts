/**
 * Creates the Angelus Media Productions studio and its site settings if they do not exist.
 * Safe to run more than once. Usage: pnpm seed
 */
import config from '@payload-config'
import { getPayload } from 'payload'

const payload = await getPayload({ config })

const slug = process.env.DEFAULT_TENANT_SLUG || 'angelus'
const existing = await payload.find({ collection: 'tenants', where: { slug: { equals: slug } }, limit: 1 })
const tenant =
  existing.docs[0] ??
  (await payload.create({
    collection: 'tenants',
    data: { name: 'Angelus Media Productions', slug, languages: ['en'], defaultLocale: 'en' },
  }))

const settings = await payload.find({
  collection: 'site-settings',
  where: { tenant: { equals: tenant.id } },
  limit: 1,
})
if (settings.totalDocs === 0) {
  await payload.create({
    collection: 'site-settings',
    data: {
      tenant: tenant.id,
      companyName: 'Angelus Media Productions',
      tagline: 'Cinematic photography, film and live production.',
    },
  })
}

payload.logger.info(`Studio "${tenant.name}" (${tenant.slug}) is ready.`)
process.exit(0)
