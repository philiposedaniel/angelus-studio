import { handleStripeWebhook } from '@/lib/stripeWebhook'

// Stripe signs the raw body, so the request is read as text and never parsed first.
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  return handleStripeWebhook(request)
}
