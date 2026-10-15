import type { CollectionConfig } from 'payload'

import { galleryRead, galleryStaff } from '@/access/galleries'
import { uniqueSlugPerTenant } from '@/hooks/uniqueSlugPerTenant'

/**
 * A private photo gallery delivered to one or more clients of a studio.
 * Clients only ever see galleries they are assigned to, once published and until expiry.
 */
export const Galleries: CollectionConfig = {
  slug: 'galleries',
  admin: {
    useAsTitle: 'title',
    defaultColumns: ['title', 'status', 'expiresAt', 'updatedAt'],
    group: 'Client delivery',
  },
  access: {
    read: galleryRead(),
    create: galleryStaff,
    update: galleryStaff,
    delete: galleryStaff,
  },
  hooks: {
    beforeValidate: [uniqueSlugPerTenant('galleries')],
  },
  fields: [
    { name: 'title', type: 'text', required: true, localized: true },
    {
      name: 'slug',
      type: 'text',
      required: true,
      index: true,
      validate: (value: string | null | undefined) =>
        !value ||
        /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) ||
        'Use lowercase letters, numbers and hyphens.',
    },
    { name: 'description', type: 'textarea', localized: true },
    {
      name: 'clients',
      type: 'relationship',
      relationTo: 'users',
      hasMany: true,
      index: true,
      admin: { description: 'People who can see this gallery in their client portal.' },
      // Only offer members of the gallery's own studio.
      filterOptions: ({ data }) =>
        data?.tenant ? { 'tenants.tenant': { equals: data.tenant } } : false,
    },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'draft',
      index: true,
      options: [
        { label: 'Draft (only staff can see it)', value: 'draft' },
        { label: 'Published to clients', value: 'published' },
      ],
      admin: { position: 'sidebar' },
    },
    {
      name: 'expiresAt',
      type: 'date',
      admin: {
        position: 'sidebar',
        description: 'After this date clients can no longer open the gallery. Leave empty for no expiry.',
      },
    },
    {
      name: 'allowDownloads',
      type: 'checkbox',
      defaultValue: true,
      admin: {
        position: 'sidebar',
        description: 'Let clients download full-resolution originals.',
      },
    },
  ],
}
