import config from '@payload-config'
import type Stripe from 'stripe'
import { getPayload, type Payload } from 'payload'

import { STRIPE_PAYMENT_CONTEXT } from '@/collections/Quotes'
import { idOf } from '@/lib/ids'
import { getStripe, stripeConfigured } from '@/lib/stripe'
import { balanceAmount, PAID_QUOTE_STATUSES } from '@/lib/quotes'
import { PAID_TICKET_CONTEXT } from '@/lib/tickets'
import type { Payment } from '@/payload-types'

/** Events that can mean a payment has been made. */
const PAID_EVENTS = new Set(['checkout.session.completed', 'checkout.session.async_payment_succeeded'])
/** A Checkout session that ran out unpaid: a ticket's held places are freed. Other events are ignored. */
const EXPIRED_EVENT = 'checkout.session.expired'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

/** Creates the payment record for a Checkout session that the website did not get to save. */
async function recordMissingPayment(payload: Payload, session: Stripe.Checkout.Session) {
  if (session.metadata?.kind === 'ticket') return recordMissingTicketPayment(payload, session)
  const quoteId = session.metadata?.quoteId
  const tenantId = session.metadata?.tenantId
  if (!quoteId || !tenantId) return null
  const quote = await payload
    .findByID({ collection: 'quotes', id: quoteId, depth: 0, overrideAccess: true })
    .catch(() => null)
  if (!quote || String(idOf(quote.tenant)) !== tenantId) return null
  const kind = session.metadata?.kind === 'balance' ? 'balance' : 'deposit'
  return payload.create({
    collection: 'payments',
    data: {
      tenant: Number(tenantId),
      quote: quote.id,
      kind,
      amount: kind === 'balance' ? balanceAmount(quote) : (quote.depositAmount ?? 0),
      currency: quote.currency,
      status: 'pending',
      stripeSessionId: session.id,
    },
    overrideAccess: true,
  })
}

async function recordMissingTicketPayment(payload: Payload, session: Stripe.Checkout.Session) {
  const registrationId = session.metadata?.registrationId
  const tenantId = session.metadata?.tenantId
  if (!registrationId || !tenantId) return null
  const registration = await payload
    .findByID({ collection: 'registrations', id: registrationId, depth: 0, overrideAccess: true })
    .catch(() => null)
  if (!registration || String(idOf(registration.tenant)) !== tenantId) return null
  return payload.create({
    collection: 'payments',
    data: {
      tenant: Number(tenantId),
      registration: registration.id,
      kind: 'ticket',
      amount: registration.amount ?? 0,
      currency: registration.currency ?? 'eur',
      status: 'pending',
      stripeSessionId: session.id,
    },
    overrideAccess: true,
  })
}

/**
 * Confirms the registration a verified ticket payment is for. A registration still waiting is
 * confirmed, even if its hold ran out, because the money is in. One that staff cancelled meanwhile
 * stays cancelled, and the payment is kept so it can be refunded in Stripe.
 */
async function confirmTicket(payload: Payload, payment: Payment) {
  const registrationId = idOf(payment.registration)
  if (registrationId === undefined || registrationId === null) return
  const registration = await payload.findByID({ collection: 'registrations', id: registrationId, depth: 0, overrideAccess: true })
  if (registration.status === 'pending') {
    await payload.update({
      collection: 'registrations',
      id: registrationId,
      data: { status: 'confirmed', holdExpiresAt: null },
      context: PAID_TICKET_CONTEXT,
      overrideAccess: true,
    })
  } else if (registration.status === 'cancelled') {
    payload.logger.error({
      msg: 'Ticket paid after its registration was cancelled; refund it in Stripe',
      paymentId: payment.id,
      registrationId,
    })
  }
}

/** Frees the places of a ticket whose Checkout session expired unpaid. */
async function expireTicket(payload: Payload, session: Stripe.Checkout.Session, eventId: string) {
  const { docs } = await payload.find({
    collection: 'payments',
    where: { stripeSessionId: { equals: session.id } },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })
  const payment = docs[0]
  if (!payment || payment.kind !== 'ticket' || payment.status !== 'pending') return false
  const registrationId = idOf(payment.registration)
  if (registrationId !== undefined && registrationId !== null) {
    const registration = await payload
      .findByID({ collection: 'registrations', id: registrationId, depth: 0, overrideAccess: true })
      .catch(() => null)
    if (registration?.status === 'pending') {
      await payload.update({
        collection: 'registrations',
        id: registrationId,
        data: { status: 'cancelled', holdExpiresAt: null },
        overrideAccess: true,
      })
    }
  }
  await payload.update({
    collection: 'payments',
    id: payment.id,
    data: { status: 'expired', stripeEventId: eventId },
    overrideAccess: true,
  })
  return true
}

/**
 * Handles Stripe webhooks. The signature is checked against the webhook secret before
 * anything is read or changed. A payment is recorded as paid only when Stripe reports it
 * paid and the amount and currency match what the quote or ticket asked for. Stripe repeats
 * events until they are acknowledged, so handling the same event twice changes nothing.
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

  if (event.type === EXPIRED_EVENT) {
    const payload = await getPayload({ config })
    try {
      const handled = await expireTicket(payload, event.data.object as Stripe.Checkout.Session, event.id)
      return json({ received: true, handled })
    } catch (error) {
      payload.logger.error({ err: error, msg: 'Could not release an expired ticket; Stripe will retry' })
      return json({ error: 'Could not release the ticket.' }, 500)
    }
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

    // The ticket or quote first: if this fails, Stripe retries the event and the payment is still pending.
    if (payment.kind === 'ticket') {
      await confirmTicket(payload, payment)
      await payload.update({
        collection: 'payments',
        id: payment.id,
        data: { status: 'paid', paidAt: new Date().toISOString(), stripeEventId: event.id },
        overrideAccess: true,
      })
      return json({ received: true, handled: true })
    }
    const quoteId = idOf(payment.quote)!
    const quote = await payload.findByID({ collection: 'quotes', id: quoteId, depth: 0, overrideAccess: true })
    if (payment.kind === 'balance') {
      if (quote.status === 'deposit-paid') {
        await payload.update({
          collection: 'quotes',
          id: quoteId,
          data: { status: 'paid-in-full' },
          context: STRIPE_PAYMENT_CONTEXT,
          overrideAccess: true,
        })
      } else if (quote.status !== 'paid-in-full') {
        // The balance is only offered after the deposit, so this should not happen. Keep the money record.
        payload.logger.error({
          msg: 'Balance payment received before the deposit was recorded',
          paymentId: payment.id,
          quoteId,
        })
      }
    } else if (!(PAID_QUOTE_STATUSES as readonly string[]).includes(quote.status)) {
      await payload.update({
        collection: 'quotes',
        id: quoteId,
        data: { status: 'deposit-paid' },
        context: STRIPE_PAYMENT_CONTEXT,
        overrideAccess: true,
      })
    }
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
