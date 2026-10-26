import type { TaskConfig } from 'payload'

import { GALLERY_NOTICE_TASK, deliverGalleryNotice } from '@/lib/galleryNotices'

/** Emails a gallery's clients the link when it is published with notification on. Retried when no send gets through. */
export const sendGalleryNotice: TaskConfig<{ input: { id: number }; output: { sent: number; failed: number } }> = {
  slug: GALLERY_NOTICE_TASK,
  label: 'Email gallery clients',
  inputSchema: [{ name: 'id', type: 'number', required: true }],
  retries: 3,
  handler: async ({ input, req }) => ({
    output: await deliverGalleryNotice(req.payload, input.id),
  }),
}
