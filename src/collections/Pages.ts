import type { CollectionConfig } from 'payload'

import { publishedOrTenantStaff, tenantContentEditors } from '@/access'
import { PAGE_BLOCKS } from '@/blocks'
import { uniqueSlugPerTenant } from '@/hooks/uniqueSlugPerTenant'

/** Paths the website already uses, which a page slug must not take over (events and quotes have their own pages). */
const RESERVED_SLUGS = ['portal', 's', 'admin', 'api', 'healthz', 'events', 'quote', 'invite', 'vendor']

/** Website pages built from blocks: text, videos, embed codes and photo albums. */
export const Pages: CollectionConfig = {
  slug: 'pages',
  admin: {
    useAsTitle: 'title',
    defaultColumns: ['title', 'slug', 'published', 'updatedAt'],
    group: 'Website',
  },
  access: {
    read: publishedOrTenantStaff,
    create: tenantContentEditors,
    update: tenantContentEditors,
    delete: tenantContentEditors,
  },
  hooks: {
    beforeValidate: [uniqueSlugPerTenant('pages')],
  },
  fields: [
    { name: 'title', type: 'text', required: true, localized: true },
    {
      name: 'slug',
      type: 'text',
      required: true,
      index: true,
      admin: { description: 'The page address, e.g. “portfolio” for /en/portfolio.' },
      validate: (value: string | null | undefined) => {
        if (!value) return true
        if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value))
          return 'Use lowercase letters, numbers and hyphens.'
        if (RESERVED_SLUGS.includes(value)) return 'This address is already used by the website.'
        return true
      },
    },
    { name: 'intro', type: 'textarea', localized: true },
    { name: 'layout', type: 'blocks', blocks: PAGE_BLOCKS, admin: { initCollapsed: false } },
    {
      name: 'published',
      type: 'checkbox',
      defaultValue: false,
      index: true,
      admin: { position: 'sidebar' },
    },
    {
      name: 'showInMenu',
      type: 'checkbox',
      defaultValue: false,
      admin: { position: 'sidebar', description: 'Add a link to this page in the site menu.' },
    },
    {
      name: 'menuOrder',
      type: 'number',
      defaultValue: 0,
      admin: { position: 'sidebar', condition: (data) => Boolean(data?.showInMenu) },
    },
  ],
}
