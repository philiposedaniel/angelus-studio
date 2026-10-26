import type { TaskConfig } from 'payload'

import { SELECTION_NOTICE_TASK, deliverSelectionNotice } from '@/lib/selectionNotices'

/** Emails the studio's gallery staff that a client submitted a selection. Retried when no send gets through. */
export const sendSelectionNotice: TaskConfig<{ input: { id: number }; output: { sent: number; failed: number } }> = {
  slug: SELECTION_NOTICE_TASK,
  label: 'Email gallery staff about a selection',
  inputSchema: [{ name: 'id', type: 'number', required: true }],
  retries: 3,
  handler: async ({ input, req }) => ({
    output: await deliverSelectionNotice(req.payload, input.id),
  }),
}
