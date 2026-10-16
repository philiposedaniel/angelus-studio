import config from '@payload-config'
import type Stripe from 'stripe'
import { getPayload, type Payload } from 'payload'

import { STRIPE_PAYMENT_CONTEXT } from '@/collections/Quotes'
import { idOf } from '@/lib/ids'
import { getStripe, stripeConfigured } from '@/lib/stripe'

/** Events that can mean a deposit has been paid. Other events are acknowledged and ignored. */
const PAID_EVENTS = new Set(['checkout.session.completed', 'checkout.session.async_payment_succeeded'])

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

/** Creates the payment record for a Checkout session that the website did not get to save. */
async function recordMissingPayment(payload: Payload, session: Stripe.Checkout.Session) {
  const quoteId = session.metadata?.quoteId
  const tenantId = session.metadata?.tenantId
  if (!quoteId || !tenantId) return null
  const quote = await payload
    .findByID({ collection: 'quotes', id: quoteId, depth: 0, overrideAccess: true })
    .catch(() => null)
  if (!quote || String(idOf(quote.tenant)) !== tenantId) return null
  return payload.create({
    collection: 'payments',
    data: {
      tenant: Number(tenantId),
      quote: quote.id,
      amount: quote.depositAmount ?? 0,
      currency: quote.currency,
      status: 'pending',
      stripeSessionId: session.id,
    },
    overrideAccess: true,
  })
}

/**
 * Handles Stripe webhooks. The signature is checked against the webhook secret before
 * anything is read or changed. A payment is recorded as paid only when Stripe reports it
 * paid and the amount and currency match what the quote asked for. Stripe repeats events
 * until they are acknowledged, so handling the same event twice changes nothing.
 */
export async function handleStripeWebhook(request: Request): Promise<Response> {
  if (!stripeConfigured()) return json({ error: 'Payments are not set up.' }, 503)

  const signature = request.headers.get('stripe-signature')
  if (!signature) return json({ error: 'Missing signature.' }, 400)

  const body = await request.text()
  let event: Stripe.Event
  try {
    event = getStripe().webhooks.constructEvent(body, signature, process.env.STRIPE_WEBHOOK_SECRET!)
  } catch {
    return json({ error: 'Invalid signature.' }, 400)
  }

  if (!PAID_EVENTS.has(event.type)) return json({ received: true, handled: false })

  const payload = await getPayload({ config })
  const session = event.data.object as Stripe.Checkout.Session

  try {
    const { docs } = await payload.find({
      collection: 'payments',
      where: { stripeSessionId: { equals: session.id } },
      limit: 1,
      depth: 0,
      overrideAccess: true,
    })
    // A session started by the website always has a payment record. If saving that record
    // failed after Stripe created the session, the quote in the session's metadata still names it.
    const payment = docs[0] ?? (await recordMissingPayment(payload, session))
    // Unknown sessions, or sessions not yet paid, are acknowledged; nothing is recorded.
    if (!payment) return json({ received: true, handled: false })
    if (payment.status === 'paid') return json({ received: true, duplicate: true })
    if (session.payment_status !== 'paid') return json({ received: true, handled: false })

    if (session.amount_total !== payment.amount || session.currency !== payment.currency) {
      payload.logger.error({
        msg: 'Stripe payment does not match the quote; not recorded as paid',
        paymentId: payment.id,
        sessionId: session.id,
      })
      await payload.update({
        collection: 'payments',
        id: payment.id,
        data: { status: 'failed', stripeEventId: event.id },
        overrideAccess: true,
      })
      return json({ received: true, handled: true, mismatch: true })
    }

    // Quote first: if this fails, Stripe retries the event and the payment is still pending.
    await payload.update({
      collection: 'quotes',
      id: idOf(payment.quote)!,
      data: { status: 'deposit-paid' },
      context: STRIPE_PAYMENT_CONTEXT,
      overrideAccess: true,
    })
    await payload.update({
      collection: 'payments',
      id: payment.id,
      data: { status: 'paid', paidAt: new Date().toISOString(), stripeEventId: event.id },
      overrideAccess: true,
    })
    return json({ received: true, handled: true })
  } catch (error) {
    payload.logger.error({ err: error, msg: 'Could not record a Stripe payment; Stripe will retry' })
    return json({ error: 'Could not record the payment.' }, 500)
  }
}
