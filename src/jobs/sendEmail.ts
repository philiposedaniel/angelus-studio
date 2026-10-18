import type { Payload, TaskConfig } from 'payload'

import { EMAIL_KINDS, SEND_EMAIL_TASK, type EmailKind } from '@/lib/email'
import { prepareEventEmail } from '@/lib/eventEmails'

/**
 * Writes one email from the record as it is now and sends it, unless it no longer applies or
 * another run already took it. A failed send gives the record back and throws, so it is tried
 * again. Returns whether a message went out.
 */
export async function deliverEventEmail(payload: Payload, kind: EmailKind, id: number): Promise<boolean> {
  const email = await prepareEventEmail(payload, kind, id)
  if (!email) return false
  if (!(await email.claim())) return false
  try {
    await payload.sendEmail({ to: email.to, from: email.from, subject: email.subject, text: email.text, html: email.html })
  } catch (error) {
    await email.release()
    throw error
  }
  return true
}

/**
 * Writes and sends one email outside any web request, retrying when the mail service fails.
 * The message is written from the record as it is when the job runs, and skipped if it no
 * longer applies or was already sent.
 */
export const sendEmail: TaskConfig<{ input: { kind: string; id: number }; output: { sent: boolean } }> = {
  slug: SEND_EMAIL_TASK,
  label: 'Send email',
  inputSchema: [
    { name: 'kind', type: 'select', options: [...EMAIL_KINDS], required: true },
    { name: 'id', type: 'number', required: true },
  ],
  retries: 3,
  handler: async ({ input, req }) => {
    if (!EMAIL_KINDS.includes(input.kind as EmailKind)) return { output: { sent: false } }
    return { output: { sent: await deliverEventEmail(req.payload, input.kind as EmailKind, input.id) } }
  },
}
