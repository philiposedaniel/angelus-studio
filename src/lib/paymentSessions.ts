import type { Payload } from 'payload'

/** Expires one open Checkout session at the payment provider. Throws when the session cannot be expired. */
export type ExpireSession = (sessionId: string) => Promise<unknown>

/**
 * A deposit, a balance or one installment has one payment page at a time. Before a new Checkout session
 * is opened for it, every older session still waiting for payment is expired at Stripe and marked expired
 * here, so a second payment page for the same thing cannot be paid. If Stripe refuses to expire a session
 * (usually because it was just paid), this throws and nothing new is opened; the webhook records the payment.
 */
export async function expireWaitingPayments({
  payload,
  expire,
  tenantId,
  quoteId,
  kind,
  installmentNumber,
}: {
  payload: Payload
  expire: ExpireSession
  tenantId: number
  quoteId: number
  kind: 'deposit' | 'balance' | 'installment'
  installmentNumber: number | null
}): Promise<number> {
  const { docs } = await payload.find({
    collection: 'payments',
    where: {
      and: [
        { tenant: { equals: tenantId } },
        { quote: { equals: quoteId } },
        { kind: { equals: kind } },
        { status: { equals: 'pending' } },
        ...(installmentNumber === null ? [] : [{ installmentNumber: { equals: installmentNumber } }]),
      ],
    },
    limit: 100,
    depth: 0,
    overrideAccess: true,
  })
  for (const doc of docs) {
    if (doc.stripeSessionId) await expire(doc.stripeSessionId)
    await payload.update({ collection: 'payments', id: doc.id, data: { status: 'expired' }, overrideAccess: true })
  }
  return docs.length
}
