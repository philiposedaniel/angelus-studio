import type { Payload, PayloadHandler } from 'payload'
import type Stripe from 'stripe'

import { hasTenantRole, isSuperAdmin } from '@/access'
import { PAYMENT_ROLES } from '@/collections/Payments'
import { idOf, parseRowId } from '@/lib/ids'
import { getStripe, stripeConfigured } from '@/lib/stripe'
import type { Payment, User } from '@/payload-types'

/** What Stripe needs to refund a ticket payment in full; tests replace the calls to Stripe. */
export type TicketRefundRequest = {
  paymentIntentId: string
  amount: number
  metadata: Record<string, string>
  /** The same key for the same payment, so a repeated click never refunds twice. */
  idempotencyKey: string
}

export type TicketRefunds = {
  /** The Stripe payment behind a Checkout session, for payments saved before it was stored. */
  paymentIntentFor: (sessionId: string) => Promise<string | null>
  createRefund: (request: TicketRefundRequest) => Promise<{ id: string }>
}

const stripeRefunds: TicketRefunds = {
  paymentIntentFor: async (sessionId) => {
    const session = await getStripe().checkout.sessions.retrieve(sessionId)
    return typeof session.payment_intent === 'string' ? session.payment_intent : (session.payment_intent?.id ?? null)
  },
  createRefund: async (request) => {
    const refund = await getStripe().refunds.create(
      { payment_intent: request.paymentIntentId, amount: request.amount, metadata: request.metadata },
      { idempotencyKey: request.idempotencyKey },
    )
    return { id: refund.id }
  },
}

export type RefundState =
  | { status: 'requested' }
  | { status: 'error'; reason: 'forbidden' | 'notFound' | 'notPaid' | 'notSetUp' | 'failed' }

/** Who may give money back: the studio's admins and finance managers. */
export const canRefund = (user: User | null | undefined, tenantId: number | string | undefined | null) =>
  Boolean(user) && (isSuperAdmin(user) || (tenantId != null && hasTenantRole(user, tenantId, PAYMENT_ROLES)))

/**
 * Refunds a paid ticket in full through Stripe and cancels its registration at once, so the ticket
 * stops working at the door and its places go back on sale (or to the waitlist). The payment is
 * marked "refund requested"; only Stripe's verified webhook marks it refunded.
 */
export async function refundTicket({
  payload,
  user,
  registrationId,
  stripe = stripeRefunds,
}: {
  payload: Payload
  user: User | null | undefined
  registrationId: unknown
  stripe?: TicketRefunds
}): Promise<RefundState> {
  if (!user) return { status: 'error', reason: 'forbidden' }
  if (typeof registrationId !== 'string' && typeof registrationId !== 'number') return { status: 'error', reason: 'notFound' }
  if (parseRowId(String(registrationId)) === null) return { status: 'error', reason: 'notFound' }
  const registration = await payload
    .findByID({ collection: 'registrations', id: String(registrationId), depth: 0, overrideAccess: true })
    .catch(() => null)
  // Someone without the right gets the same answer whether or not the registration exists.
  if (!registration || !canRefund(user, idOf(registration.tenant))) return { status: 'error', reason: 'forbidden' }
  if (!stripeConfigured()) return { status: 'error', reason: 'notSetUp' }

  const { docs } = await payload.find({
    collection: 'payments',
    where: { and: [{ registration: { equals: registration.id } }, { kind: { equals: 'ticket' } }, { status: { equals: 'paid' } }] },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })
  const payment = docs[0]
  if (!payment) return { status: 'error', reason: 'notPaid' }

  // Marked first, and with the Stripe payment it refunds, so the webhook reporting the refund
  // always finds this payment and is never overwritten by a later save from here.
  const restore = () =>
    payload.update({ collection: 'payments', id: payment.id, data: { status: 'paid' }, overrideAccess: true })
  try {
    const paymentIntentId = payment.stripePaymentIntentId ?? (await stripe.paymentIntentFor(payment.stripeSessionId))
    if (!paymentIntentId) throw new Error('Stripe has no payment for this Checkout session')
    await payload.update({
      collection: 'payments',
      id: payment.id,
      data: { status: 'refund-pending', stripePaymentIntentId: paymentIntentId },
      overrideAccess: true,
    })
    try {
      const refund = await stripe.createRefund({
        paymentIntentId,
        amount: payment.amount,
        metadata: { paymentId: String(payment.id), registrationId: String(registration.id), kind: 'ticket-refund' },
        idempotencyKey: `ticket-refund-${payment.id}`,
      })
      await payload.update({ collection: 'payments', id: payment.id, data: { stripeRefundId: refund.id }, overrideAccess: true })
    } catch (error) {
      await restore()
      throw error
    }
  } catch (error) {
    payload.logger.error({ err: error, msg: 'Stripe could not refund a ticket', paymentId: payment.id })
    return { status: 'error', reason: 'failed' }
  }

  if (registration.status !== 'cancelled') {
    await payload.update({
      collection: 'registrations',
      id: registration.id,
      data: { status: 'cancelled', holdExpiresAt: null },
      overrideAccess: true,
    })
  }
  return { status: 'requested' }
}

/**
 * Records a refund Stripe reports on a charge (`charge.refunded`), whether it was asked for here
 * or made in the Stripe dashboard. A ticket refunded in full has its registration cancelled.
 * Returns false when the charge is not one of ours.
 */
export async function recordRefund(payload: Payload, charge: Stripe.Charge, eventId: string) {
  const paymentIntentId = typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id
  if (!paymentIntentId) return false
  const { docs } = await payload.find({
    collection: 'payments',
    where: { stripePaymentIntentId: { equals: paymentIntentId } },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })
  const payment: Payment | undefined = docs[0]
  if (!payment || payment.stripeEventId === eventId) return false
  // Stripe can deliver events out of order: an older, smaller refund total never replaces a newer one.
  if ((payment.refundedAmount ?? 0) > charge.amount_refunded) return false

  const full = charge.refunded === true || charge.amount_refunded >= payment.amount
  await payload.update({
    collection: 'payments',
    id: payment.id,
    data: {
      status: full ? 'refunded' : payment.status,
      refundedAmount: charge.amount_refunded,
      refundedAt: new Date().toISOString(),
      stripeEventId: eventId,
    },
    overrideAccess: true,
  })
  const registrationId = idOf(payment.registration)
  if (full && payment.kind === 'ticket' && registrationId != null) {
    const registration = await payload
      .findByID({ collection: 'registrations', id: registrationId, depth: 0, overrideAccess: true })
      .catch(() => null)
    if (registration && registration.status !== 'cancelled') {
      await payload.update({
        collection: 'registrations',
        id: registrationId,
        data: { status: 'cancelled', holdExpiresAt: null },
        overrideAccess: true,
      })
    }
  }
  return true
}

const MESSAGES: Record<Exclude<RefundState, { status: 'requested' }>['reason'], [number, string]> = {
  forbidden: [403, 'Only studio admins and finance managers can refund tickets.'],
  notFound: [404, 'Registration not found.'],
  notPaid: [409, 'This registration has no online payment to refund.'],
  notSetUp: [503, 'Online payments are not set up.'],
  failed: [502, 'Stripe could not make the refund. Nothing was changed; please try again or refund in Stripe.'],
}

/** POST /api/registrations/:id/refund, from the registration's admin page. */
export const refundTicketEndpoint: PayloadHandler = async (req) => {
  if (!req.user) return Response.json({ errors: [{ message: 'Sign in first.' }] }, { status: 401 })
  const result = await refundTicket({
    payload: req.payload,
    user: req.user as User,
    registrationId: req.routeParams?.id,
  })
  if (result.status === 'requested') return Response.json({ status: 'requested' })
  const [status, message] = MESSAGES[result.reason]
  return Response.json({ errors: [{ message }] }, { status })
}
