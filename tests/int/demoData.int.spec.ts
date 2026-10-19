import { getPayload, type Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { DemoDataRefused, demoEmail, seedDemoData } from '@/lib/demoData'
import config from '@/payload.config'

const SLUG = 'int-demo'

let payload: Payload

const cleanup = async () => {
  await payload.delete({
    collection: 'users',
    where: { email: { equals: 'int-demo-real@angelus.test' } },
  })
  const { docs } = await payload.find({
    collection: 'tenants',
    where: { slug: { equals: SLUG } },
    depth: 0,
  })
  const tenant = docs[0]
  if (!tenant) return
  const byTenant = { tenant: { equals: tenant.id } }
  for (const collection of [
    'waitlist-entries',
    'promo-codes',
    'event-vendors',
    'event-tables',
    'equipment-reservations',
    'equipment',
    'vendors',
    'services',
    'inquiries',
  ] as const) {
    await payload.delete({ collection, where: byTenant, overrideAccess: true })
  }
  // Deleting events removes their guests, ticket types and registrations.
  await payload.delete({ collection: 'events', where: { tenant: { equals: tenant.id } } })
  await payload.delete({ collection: 'projects', where: { tenant: { equals: tenant.id } } })
  await payload.delete({
    collection: 'quotes',
    where: { tenant: { equals: tenant.id } },
    overrideAccess: true,
  })
  const galleries = await payload.find({
    collection: 'galleries',
    where: { tenant: { equals: tenant.id } },
    depth: 0,
  })
  const ids = galleries.docs.map((g) => g.id)
  await payload.delete({ collection: 'gallery-photos', where: { gallery: { in: ids } } })
  await payload.delete({ collection: 'galleries', where: { id: { in: ids } } })
  await payload.delete({ collection: 'users', where: { email: { like: `@${SLUG}.demo.test` } } })
  await payload.delete({ collection: 'site-settings', where: { tenant: { equals: tenant.id } } })
  await payload.delete({ collection: 'tenants', where: { id: { equals: tenant.id } } })
}

beforeAll(async () => {
  payload = await getPayload({ config })
  await cleanup()
})
afterAll(async () => {
  await cleanup()
})

describe('demo data', () => {
  it('refuses a database that already has real accounts', async () => {
    await payload.create({
      collection: 'users',
      data: { email: `int-demo-real@angelus.test`, password: 'int-Password-1', roles: ['user'] },
    })
    try {
      await expect(seedDemoData(payload, { tenantSlug: SLUG })).rejects.toBeInstanceOf(
        DemoDataRefused,
      )
      const tenants = await payload.find({
        collection: 'tenants',
        where: { slug: { equals: SLUG } },
      })
      expect(tenants.totalDocs).toBe(0)
    } finally {
      await payload.delete({
        collection: 'users',
        where: { email: { equals: 'int-demo-real@angelus.test' } },
      })
    }
  })

  // Generating and resizing eight full-size photos can take longer than the default limit on a busy machine.
  it('seeds a connected demo studio once, with sign-ins that stay inside it', async () => {
    const first = await seedDemoData(payload, { tenantSlug: SLUG, allowExistingUsers: true })
    expect(first.created).toBe(true)
    expect(first.admin.password).toBeTruthy()
    expect(first.links.every((l) => !l.path.endsWith('/'))).toBe(true)

    const client = (
      await payload.find({
        collection: 'users',
        where: { email: { equals: demoEmail('client', SLUG) } },
      })
    ).docs[0]!
    // The demo client sees their own gallery through access control, and nothing else.
    const visible = await payload.find({
      collection: 'galleries',
      user: client,
      overrideAccess: false,
      depth: 0,
    })
    expect(visible.docs.map((g) => g.slug)).toEqual(['demo-ana-joao-wedding'])
    expect(visible.docs[0]!.selectionLimit).toBe(5)
    // Neither demo account is a platform administrator.
    const admin = (
      await payload.find({
        collection: 'users',
        where: { email: { equals: demoEmail('admin', SLUG) } },
      })
    ).docs[0]!
    expect(admin.roles).not.toContain('super-admin')

    // The rest of the studio is filled in too, all inside the demo studio.
    const counts = Object.fromEntries(
      await Promise.all(
        (
          [
            'services',
            'inquiries',
            'equipment',
            'equipment-reservations',
            'vendors',
            'event-vendors',
            'event-tables',
            'promo-codes',
            'waitlist-entries',
          ] as const
        ).map(async (collection) => [
          collection,
          (await payload.count({ collection, where: { tenant: { equals: first.tenant.id } } }))
            .totalDocs,
        ]),
      ),
    )
    expect(counts).toEqual({
      services: 3,
      inquiries: 1,
      equipment: 3,
      'equipment-reservations': 2,
      vendors: 2,
      'event-vendors': 2,
      'event-tables': 2,
      'promo-codes': 1,
      'waitlist-entries': 1,
    })
    const seated = await payload.count({
      collection: 'event-guests',
      where: { tenant: { equals: first.tenant.id }, table: { exists: true } },
    })
    expect(seated.totalDocs).toBeGreaterThanOrEqual(2)

    const again = await seedDemoData(payload, { tenantSlug: SLUG, allowExistingUsers: true })
    expect(again.created).toBe(false)
    expect(again.admin.password).toBeUndefined()
    const galleries = await payload.find({
      collection: 'galleries',
      where: { tenant: { equals: first.tenant.id } },
    })
    expect(galleries.totalDocs).toBe(1)
  }, 60_000)
})
