import type { CollectionConfig } from 'payload'

import { anyone, superAdminsOnly, tenantAdmins } from '@/access'

/** One settings document per studio (the multi-tenant plugin treats it as a per-tenant global). */
export const SiteSettings: CollectionConfig = {
  slug: 'site-settings',
  labels: { singular: 'Site settings', plural: 'Site settings' },
  admin: { useAsTitle: 'companyName' },
  access: {
    read: anyone,
    create: tenantAdmins,
    update: tenantAdmins,
    delete: superAdminsOnly,
  },
  fields: [
    { name: 'companyName', type: 'text', required: true },
    { name: 'tagline', type: 'text', localized: true },
    { name: 'introduction', type: 'textarea', localized: true },
    { name: 'heroImage', type: 'upload', relationTo: 'media' },
    {
      type: 'group',
      name: 'contact',
      fields: [
        { name: 'email', type: 'email' },
        { name: 'phone', type: 'text' },
        {
          name: 'whatsapp',
          type: 'text',
          admin: { description: 'International format without spaces, for example 15551234567.' },
          validate: (value: string | null | undefined) =>
            !value || /^\d{7,15}$/.test(value) || 'Digits only, 7 to 15 of them.',
        },
        { name: 'address', type: 'textarea', localized: true },
      ],
    },
    {
      name: 'socialLinks',
      type: 'array',
      fields: [
        {
          name: 'platform',
          type: 'select',
          required: true,
          options: ['instagram', 'facebook', 'youtube', 'vimeo', 'tiktok', 'linkedin', 'x'],
        },
        {
          name: 'url',
          type: 'text',
          required: true,
          validate: (value: string | null | undefined) =>
            !value || /^https:\/\//.test(value) || 'Use a full https:// address.',
        },
      ],
    },
  ],
}
