import type { UIFieldServerProps } from 'payload'

import { idOf } from '@/lib/ids'
import { formatMoney } from '@/lib/money'
import { canRefund } from '@/lib/ticketRefunds'
import { stripeConfigured } from '@/lib/stripe'
import type { User } from '@/payload-types'

import { RefundButton } from './RefundButton'

/** A paid ticket's online payment, and the button that refunds it, for admins and finance managers. */
export async function RefundField(props: UIFieldServerProps) {
  const registrationId = props.id ?? props.data?.id
  const user = props.req.user as User | null
  if (registrationId == null || !canRefund(user, idOf(props.data?.tenant))) return null
  const { docs } = await props.payload.find({
    collection: 'payments',
    where: { and: [{ registration: { equals: registrationId } }, { kind: { equals: 'ticket' } }] },
    sort: '-createdAt',
    depth: 0,
    pagination: false,
    user,
    overrideAccess: false,
  })
  const payment = docs.find((p) => ['paid', 'refund-pending', 'refunded'].includes(p.status))
  if (!payment) return null
  const amount = formatMoney(payment.amount, payment.currency, 'en')
  const box: React.CSSProperties = { display: 'grid', gap: 8, marginBottom: 24 }

  return (
    <div style={box}>
      <strong>Payment</strong>
      {payment.status === 'paid' && (
        <>
          <p style={{ margin: 0 }}>Paid {amount} online.</p>
          {stripeConfigured() ? (
            <RefundButton registrationId={registrationId} label={`Refund ${amount} and cancel`} />
          ) : (
            <p style={{ margin: 0, fontSize: 12, opacity: 0.75 }}>Set up Stripe to refund from here.</p>
          )}
        </>
      )}
      {payment.status === 'refund-pending' && (
        <p style={{ margin: 0 }}>Refund of {amount} requested. Stripe confirms it shortly; the registration is cancelled.</p>
      )}
      {payment.status === 'refunded' && <p style={{ margin: 0 }}>Refunded {amount}.</p>}
    </div>
  )
}
