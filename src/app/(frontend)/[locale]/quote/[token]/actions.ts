'use server'

import config from '@payload-config'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { getPayload } from 'payload'

import { getDictionary } from '@/i18n/dictionaries'
import { isLocale } from '@/i18n/config'
import { isShareToken } from '@/lib/shareTokens'
import { getStripe, stripeConfigured } from '@/lib/stripe'
import { balanceAmount, isQuoteExpired } from '@/lib/quotes'
import { getCurrentTenant } from '@/lib/tenant'

export type PaymentState = { status: 'idle' } | { status: 'error'; message: 'failed' | 'unavailable' }

/** The address the visitor is on, so Stripe sends them back to the same studio site. */
async function siteOrigin() {
  const requestHeaders = await headers()
  const host = requestHeaders.get('x-forwarded-host') ?? requestHeaders.get('host')
  const proto = requestHeaders.get('x-forwarded-proto') ?? (process.env.NODE_ENV === 'production' ? 'https' : 'http')
  return `${proto}://${host}`
}

type PaymentKind = 'deposit' | 'balance'

/**
 * Starts a Stripe Checkout session for the deposit, or for the balance once the deposit is paid.
 * The amount comes from the stored quote, never from the form; the form only names the quote.
 * The quote is marked paid by the verified webhook, not here.
 */
async function startPayment(form: FormData, kind: PaymentKind): Promise<PaymentState> {
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
        { status: { in: kind === 'deposit' ? ['sent'] : ['deposit-paid'] } },
      ],
    },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })
  const quote = docs[0]
  if (!quote) return { status: 'error', message: 'failed' }
  // The deposit may expire; the balance is due after a deposit that was already accepted.
  if (kind === 'deposit' && isQuoteExpired(quote.validUntil)) return { status: 'error', message: 'failed' }
  const amount = kind === 'deposit' ? (quote.depositAmount ?? 0) : balanceAmount(quote)
  if (amount <= 0) return { status: 'error', message: 'failed' }

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
          unit_amount: amount,
          product_data: {
            name: `${kind === 'deposit' ? t.depositName : t.balanceName}: ${quote.title}`.slice(0, 250),
          },
        },
      },
    ],
    metadata: { quoteId: String(quote.id), tenantId: String(tenant.id), kind },
    success_url: `${back}?payment=success`,
    cancel_url: `${back}?payment=cancelled`,
  })
  if (!session.url) return { status: 'error', message: 'failed' }

  await payload.create({
    collection: 'payments',
    data: {
      tenant: tenant.id,
      quote: quote.id,
      kind,
      amount,
      currency: quote.currency,
      status: 'pending',
      stripeSessionId: session.id,
    },
    overrideAccess: true,
  })

  // Outside the try-free path on purpose: redirect() works by throwing.
  redirect(session.url)
}

export async function payDeposit(_previous: PaymentState, form: FormData): Promise<PaymentState> {
  return startPayment(form, 'deposit')
}

export async function payBalance(_previous: PaymentState, form: FormData): Promise<PaymentState> {
  return startPayment(form, 'balance')
}
