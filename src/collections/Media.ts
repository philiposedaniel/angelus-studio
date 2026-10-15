import type { CollectionConfig } from 'payload'

import { anyone, staffOnly } from '@/access'

/**
 * Public website media (hero images, portfolio covers, team photos).
 * Private client photos and videos will live in a separate collection backed by
 * private object storage and signed URLs; never put client deliverables here.
 */
export const Media: CollectionConfig = {
  slug: 'media',
  admin: {
    description: 'Public website images only. Client deliverables go in client galleries.',
  },
  access: {
    read: anyone,
    create: staffOnly,
    update: staffOnly,
    delete: staffOnly,
  },
  fields: [
    {
      name: 'alt',
      type: 'text',
      required: true,
    },
  ],
  upload: {
    mimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/avif'],
    imageSizes: [
      { name: 'thumbnail', width: 400 },
      { name: 'card', width: 960 },
      { name: 'hero', width: 2400 },
    ],
  },
}
