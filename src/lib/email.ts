import { nodemailerAdapter } from '@payloadcms/email-nodemailer'
import type { PayloadRequest } from 'payload'

/**
 * Email goes out through any SMTP service (Resend, Postmark, Amazon SES, a mail server), set
 * with the SMTP_* and EMAIL_FROM_* variables. Without them nothing is sent: callers check
 * `emailConfigured()` first, because Payload would otherwise only print messages to the log.
 */
export const emailConfigured = () => Boolean(process.env.SMTP_HOST && process.env.EMAIL_FROM_ADDRESS)

/** The email adapter for the Payload config, or none when email is not set up. */
export function emailAdapter() {
  if (!emailConfigured()) return undefined
  const port = Number(process.env.SMTP_PORT || 587)
  return nodemailerAdapter({
    defaultFromAddress: process.env.EMAIL_FROM_ADDRESS!,
    defaultFromName: process.env.EMAIL_FROM_NAME || 'Angelus Media Productions',
    transportOptions: {
      host: process.env.SMTP_HOST,
      port,
      // Port 465 speaks TLS from the start; other ports upgrade with STARTTLS.
      secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === 'true' : port === 465,
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } : undefined,
    },
  })
}

/** The sender as people see it: the studio's name with the platform's sending address. */
export const fromStudio = (studioName: string) =>
  `"${studioName.replace(/["\\\r\n]/g, '')}" <${process.env.EMAIL_FROM_ADDRESS}>`

export const EMAIL_KINDS = ['invitation', 'ticket', 'waitlistOffer', 'replyReminder', 'guestDayBefore', 'ticketDayBefore', 'replyNotice'] as const
export type EmailKind = (typeof EMAIL_KINDS)[number]

export const SEND_EMAIL_TASK = 'send-email'

/**
 * Queues one email to be written and sent in the background, in the same transaction as the
 * change that calls for it, so a change that is rolled back sends nothing. Does nothing when
 * email is not set up. Returns whether it was queued.
 */
export async function queueEmail(req: PayloadRequest, kind: EmailKind, id: number) {
  if (!emailConfigured()) return false
  await req.payload.jobs.queue({ task: SEND_EMAIL_TASK, input: { kind, id }, req })
  return true
}

const escapes: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
export const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (c) => escapes[c]!)

export type EmailMessage = { to: string; subject: string; paragraphs: string[]; action: { label: string; url: string }; note?: string }

/** Plain text and simple HTML versions of a message: some paragraphs, one button, a small note. */
export function renderEmail(message: EmailMessage, studioName: string) {
  const text = [...message.paragraphs, `${message.action.label}: ${message.action.url}`, ...(message.note ? [message.note] : []), `— ${studioName}`].join('\n\n')
  const p = (value: string) => `<p style="margin:0 0 16px;line-height:1.5">${escapeHtml(value)}</p>`
  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#f6f4ef;font-family:Helvetica,Arial,sans-serif;color:#1c1b19">
<div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px">
${message.paragraphs.map(p).join('\n')}
<p style="margin:24px 0"><a href="${escapeHtml(message.action.url)}" style="display:inline-block;background:#1c1b19;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:999px">${escapeHtml(message.action.label)}</a></p>
${message.note ? `<p style="margin:0 0 16px;font-size:13px;color:#5f5c55;line-height:1.5">${escapeHtml(message.note)}</p>` : ''}
<p style="margin:24px 0 0;font-size:13px;color:#5f5c55">${escapeHtml(studioName)}</p>
</div></body></html>`
  return { text, html }
}
