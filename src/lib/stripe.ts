import Stripe from 'stripe'

/**
 * Online payments need two secrets from the Stripe dashboard: the API key (for creating
 * Checkout sessions) and the webhook signing secret (for trusting webhook calls). Without
 * both, the website shows no payment button rather than a button that cannot work.
 */
export const stripeConfigured = () =>
  Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_WEBHOOK_SECRET)

let client: Stripe | undefined

export function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) throw new Error('STRIPE_SECRET_KEY is not set')
  client ??= new Stripe(key)
  return client
}
