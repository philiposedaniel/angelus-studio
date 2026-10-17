'use server'

import config from '@payload-config'
import { headers } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { getPayload } from 'payload'

import { getDictionary } from '@/i18n/dictionaries'
import { isLocale } from '@/i18n/config'
import { contractRequired, contractSigned, signatureName, termsFingerprint } from '@/lib/contracts'
import { isShareToken } from '@/lib/shareTokens'
import { getStripe, stripeConfigured } from '@/lib/stripe'
import { isQuoteExpired } from '@/lib/quotes'
import { getCurrentTenant } from '@/lib/tenant'

export type DepositState =
  | { status: 'idle' }
  | { status: 'error'; message: 'failed' | 'unavailable' | 'unsigned' }

export type SignState = { status: 'idle' } | { status: 'error'; message: 'failed' | 'invalid' }

/** The quote a visitor can act on through its link: the studio's own, still open to the client. */
async function openQuoteByToken(token: string) {
  const tenant = await getCurrentTenant()
  if (!tenant) return null
  const payload = await getPayload({ config })
  // Visitors have no access to quotes; the token and the studio of the site are the key.
  const { docs } = await payload.find({
    collection: 'quotes',
    where: {
      and: [
        { tenant: { equals: tenant.id } },
        { publicToken: { equals: token } },
        { status: { equals: 'sent' } },
      ],
    },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })
  return { tenant, payload, quote: docs[0] ?? null }
}

/** The address the visitor is on, so Stripe sends them back to the same studio site. */
async function siteOrigin() {
  const requestHeaders = await headers()
  const host = requestHeaders.get('x-forwarded-host') ?? requestHeaders.get('host')
  const proto = requestHeaders.get('x-forwarded-proto') ?? (process.env.NODE_ENV === 'production' ? 'https' : 'http')
  return `${proto}://${host}`
}

/**
 * Starts a Stripe Checkout session for a quote's deposit, then sends the client to Stripe.
 * The amount comes from the stored quote, never from the form; the form only names the quote.
 * The quote is then marked paid by the webhook, not here.
 */
export async function payDeposit(_previous: DepositState, form: FormData): Promise<DepositState> {
  const token = form.get('token')
  const requested = form.get('locale')
  if (!isShareToken(token) || typeof requested !== 'string' || !isLocale(requested)) {
    return { status: 'error', message: 'failed' }
  }
  if (!stripeConfigured()) return { status: 'error', message: 'unavailable' }

  const open = await openQuoteByToken(token)
  if (!open) return { status: 'error', message: 'failed' }
  const { tenant, payload, quote } = open
  const depositAmount = quote?.depositAmount ?? 0
  if (!quote || isQuoteExpired(quote.validUntil) || depositAmount <= 0) {
    return { status: 'error', message: 'failed' }
  }
  // The deposit is paid only once the client has signed the contract the quote carries.
  if (contractRequired(quote.contract) && !contractSigned(quote.contract)) {
    return { status: 'error', message: 'unsigned' }
  }

  const origin = await siteOrigin()
  const back = `${origin}/${requested}/quote/${token}`
  const t = getDictionary(requested).quote
  const session = await getStripe().checkout.sessions.create({
    mode: 'payment',
    customer_email: quote.clientEmail,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: quote.currency,
          unit_amount: depositAmount,
          product_data: { name: `${t.depositName}: ${quote.title}`.slice(0, 250) },
        },
      },
    ],
    metadata: { quoteId: String(quote.id), tenantId: String(tenant.id) },
    success_url: `${back}?payment=success`,
    cancel_url: `${back}?payment=cancelled`,
  })
  if (!session.url) return { status: 'error', message: 'failed' }

  await payload.create({
    collection: 'payments',
    data: {
      tenant: tenant.id,
      quote: quote.id,
      amount: depositAmount,
      currency: quote.currency,
      status: 'pending',
      stripeSessionId: session.id,
    },
    overrideAccess: true,
  })

  // Outside the try-free path on purpose: redirect() works by throwing.
  redirect(session.url)
}

/**
 * Records the client's signature on the contract a quote carries. The typed name, the time, the
 * address and the browser are kept with the fingerprint of the exact terms, as evidence of who
 * agreed to what. The terms cannot change afterwards (see src/collections/Quotes.ts).
 */
export async function signContract(_previous: SignState, form: FormData): Promise<SignState> {
  const token = form.get('token')
  const requested = form.get('locale')
  if (!isShareToken(token) || typeof requested !== 'string' || !isLocale(requested)) {
    return { status: 'error', message: 'failed' }
  }
  const name = signatureName(form.get('name'), form.get('agree'))
  if (!name) return { status: 'error', message: 'invalid' }

  const open = await openQuoteByToken(token)
  const quote = open?.quote
  if (!open || !quote || isQuoteExpired(quote.validUntil)) return { status: 'error', message: 'failed' }
  if (!contractRequired(quote.contract) || contractSigned(quote.contract)) {
    return { status: 'error', message: 'failed' }
  }
  const terms = quote.contract?.terms ?? ''

  const requestHeaders = await headers()
  const forwarded = requestHeaders.get('x-forwarded-for')?.split(',')[0]?.trim() ?? requestHeaders.get('x-real-ip') ?? ''
  await open.payload.update({
    collection: 'quotes',
    id: quote.id,
    data: {
      contract: {
        terms,
        signedName: name,
        signedAt: new Date().toISOString(),
        signedIp: forwarded.slice(0, 100),
        signedUserAgent: (requestHeaders.get('user-agent') ?? '').slice(0, 300),
        termsFingerprint: termsFingerprint(terms),
      },
    },
    overrideAccess: true,
  })
  revalidatePath(`/${requested}/quote/${token}`)
  return { status: 'idle' }
}
