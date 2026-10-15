import type { GlobalConfig } from 'payload'

import { adminsOnly, anyone } from '@/access'

export const SiteSettings: GlobalConfig = {
  slug: 'site-settings',
  label: 'Site settings',
  access: {
    read: anyone,
    update: adminsOnly,
  },
  fields: [
    { name: 'companyName', type: 'text', required: true, defaultValue: 'Angelus Media Productions' },
    {
      name: 'tagline',
      type: 'text',
      defaultValue: 'Cinematic photography, film and live production.',
    },
    { name: 'introduction', type: 'textarea' },
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
        { name: 'address', type: 'textarea' },
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
