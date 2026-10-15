import crypto from 'crypto'
import type { Payload } from 'payload'

import { EVENT_TYPES, type EventType } from '@/lib/inquiryOptions'

/** Field-level problems, as codes the form translates. */
export type InquiryFieldError = 'required' | 'invalid' | 'tooLong'
export type InquiryField =
  'name' | 'email' | 'phone' | 'eventType' | 'eventDate' | 'location' | 'message' | 'consent'

export type InquiryState =
  | { status: 'idle' }
  | { status: 'success' }
  | {
      status: 'error'
      errors?: Partial<Record<InquiryField, InquiryFieldError>>
      reason?: 'expired' | 'tooMany' | 'failed'
    }

export type InquiryInput = {
  name: string
  email: string
  phone?: string
  eventType: EventType
  eventDate?: string
  location?: string
  message: string
}

const LIMITS = { name: 120, email: 200, phone: 40, location: 200, message: 5000 } as const
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const text = (form: FormData, key: string) => {
  const value = form.get(key)
  return typeof value === 'string' ? value.trim() : ''
}

/** Checks what the visitor typed. Returns clean input or the problems to show. */
export function validateInquiry(
  form: FormData,
  today = new Date(),
):
  | { ok: true; input: InquiryInput }
  | { ok: false; errors: Partial<Record<InquiryField, InquiryFieldError>> } {
  const errors: Partial<Record<InquiryField, InquiryFieldError>> = {}
  const name = text(form, 'name')
  const email = text(form, 'email').toLowerCase()
  const phone = text(form, 'phone')
  const eventType = text(form, 'eventType')
  const eventDate = text(form, 'eventDate')
  const location = text(form, 'location')
  const message = text(form, 'message')

  if (!name) errors.name = 'required'
  else if (name.length > LIMITS.name) errors.name = 'tooLong'
  if (!email) errors.email = 'required'
  else if (email.length > LIMITS.email || !EMAIL.test(email)) errors.email = 'invalid'
  if (phone.length > LIMITS.phone) errors.phone = 'tooLong'
  else if (phone && !/^[+\d][\d\s().-]{5,}$/.test(phone)) errors.phone = 'invalid'
  if (!(EVENT_TYPES as readonly string[]).includes(eventType)) errors.eventType = 'required'
  if (eventDate) {
    const date = /^\d{4}-\d{2}-\d{2}$/.test(eventDate) ? new Date(`${eventDate}T12:00:00Z`) : null
    const yesterday = new Date(today.getTime() - 86_400_000)
    if (!date || Number.isNaN(date.getTime()) || date < yesterday) errors.eventDate = 'invalid'
  }
  if (location.length > LIMITS.location) errors.location = 'tooLong'
  if (!message) errors.message = 'required'
  else if (message.length > LIMITS.message) errors.message = 'tooLong'
  if (form.get('consent') !== 'on') errors.consent = 'required'

  if (Object.keys(errors).length > 0) return { ok: false, errors }
  return {
    ok: true,
    input: {
      name,
      email,
      phone: phone || undefined,
      eventType: eventType as EventType,
      eventDate: eventDate || undefined,
      location: location || undefined,
      message,
    },
  }
}

/* ---- Spam protection: no third-party service, nothing stored about visitors but a keyed hash. ---- */

/** Forms answered faster than this are almost always bots. */
export const MIN_FILL_MS = 3000
/** A form older than this must be reloaded. */
export const MAX_FORM_AGE_MS = 24 * 60 * 60 * 1000
/** Submissions allowed per sender (network address) and per email address, per hour. */
export const MAX_PER_SENDER_PER_HOUR = 5
export const MAX_PER_EMAIL_PER_HOUR = 3

const secret = () => {
  const value = process.env.PAYLOAD_SECRET
  if (!value) throw new Error('PAYLOAD_SECRET is not set')
  return value
}

const sign = (value: string) =>
  crypto.createHmac('sha256', secret()).update(value).digest('base64url')

/** A signed timestamp put in the form when it is shown, tied to the studio. */
export const issueFormToken = (tenantId: number | string, now = Date.now()) =>
  `${now}.${sign(`inquiry:${tenantId}:${now}`)}`

export function checkFormToken(token: unknown, tenantId: number | string, now = Date.now()) {
  if (typeof token !== 'string') return 'invalid' as const
  const [issued, signature] = token.split('.')
  const issuedAt = Number(issued)
  if (!issued || !signature || !Number.isFinite(issuedAt)) return 'invalid' as const
  const expected = Buffer.from(sign(`inquiry:${tenantId}:${issuedAt}`))
  const given = Buffer.from(signature)
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given))
    return 'invalid' as const
  const age = now - issuedAt
  if (age < MIN_FILL_MS) return 'tooFast' as const
  if (age > MAX_FORM_AGE_MS) return 'expired' as const
  return 'ok' as const
}

/** A keyed hash of the sender's address, so repeated submissions can be limited without storing it. */
export const senderKey = (address: string | null | undefined) =>
  sign(`sender:${address || 'unknown'}`).slice(0, 32)

/** The client address from the reverse proxy (Cloudflare or the proxy in front of the app). */
export function clientAddress(headers: Headers) {
  return (
    headers.get('cf-connecting-ip') ??
    headers.get('x-real-ip') ??
    headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    null
  )
}

/** Messages stuffed with links are spam in practice. */
export const looksLikeSpam = (message: string) => (message.match(/https?:\/\//gi)?.length ?? 0) > 3

/** Saves a website inquiry after every check. Used by the form's server action. */
export async function submitInquiry({
  payload,
  tenantId,
  locale,
  form,
  address,
  now = Date.now(),
}: {
  payload: Payload
  tenantId: number
  locale: string
  form: FormData
  address: string | null
  now?: number
}): Promise<InquiryState> {
  // Bots fill every field, including this one, which people never see.
  if (text(form, 'website')) return { status: 'success' }

  const token = checkFormToken(form.get('formToken'), tenantId, now)
  if (token === 'expired' || token === 'invalid') return { status: 'error', reason: 'expired' }

  // Missing fields come first, so a person who presses Send straight away sees what to fill in.
  const result = validateInquiry(form, new Date(now))
  if (!result.ok) return { status: 'error', errors: result.errors }
  // A complete form this fast is not a person: pretend it worked, so the bot learns nothing.
  if (token === 'tooFast' || looksLikeSpam(result.input.message)) return { status: 'success' }

  const key = senderKey(address)
  const since = new Date(now - 60 * 60 * 1000).toISOString()
  const recent = async (field: 'senderKey' | 'email', value: string) =>
    (
      await payload.count({
        collection: 'inquiries',
        where: {
          and: [
            { tenant: { equals: tenantId } },
            { [field]: { equals: value } },
            { createdAt: { greater_than: since } },
          ],
        },
      })
    ).totalDocs
  if (
    (await recent('senderKey', key)) >= MAX_PER_SENDER_PER_HOUR ||
    (await recent('email', result.input.email)) >= MAX_PER_EMAIL_PER_HOUR
  ) {
    return { status: 'error', reason: 'tooMany' }
  }

  try {
    // System write: visitors have no create access; every check above stands in for it.
    await payload.create({
      collection: 'inquiries',
      data: { ...result.input, tenant: tenantId, locale, status: 'new', senderKey: key },
    })
  } catch (error) {
    payload.logger.error({ err: error, msg: 'Could not save a website inquiry' })
    return { status: 'error', reason: 'failed' }
  }
  return { status: 'success' }
}
