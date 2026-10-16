'use server'

import config from '@payload-config'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { getPayload } from 'payload'

import { getDictionary } from '@/i18n/dictionaries'
import { isLocale } from '@/i18n/config'
import { isShareToken } from '@/lib/shareTokens'
import { getStripe, stripeConfigured } from '@/lib/stripe'
import { isQuoteExpired } from '@/lib/quotes'
import { getCurrentTenant } from '@/lib/tenant'

export type DepositState = { status: 'idle' } | { status: 'error'; message: 'failed' | 'unavailable' }

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

  const tenant = await getCurrentTenant()
  if (!tenant) return { status: 'error', message: 'failed' }

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
  const quote = docs[0]
  const depositAmount = quote?.depositAmount ?? 0
  if (!quote || isQuoteExpired(quote.validUntil) || depositAmount <= 0) {
    return { status: 'error', message: 'failed' }
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
