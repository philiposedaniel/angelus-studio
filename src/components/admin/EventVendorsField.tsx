import type { UIFieldServerProps } from 'payload'

import { idOf } from '@/lib/ids'
import { formatMoney } from '@/lib/money'
import { BOOKING_STATUS_LABELS, summarizeVendorCosts, type BookingStatus } from '@/lib/vendors'

/** The vendors booked for this event, with what is owed and paid, for vendor staff. */
export async function EventVendorsField(props: UIFieldServerProps) {
  const eventId = props.id ?? props.data?.id
  const box: React.CSSProperties = { display: 'grid', gap: 8, marginBottom: 24 }
  if (eventId === undefined || eventId === null) {
    return <p style={{ margin: 0 }}>Save the event, then book vendors under Events → Event vendors.</p>
  }
  const bookings = await props.payload
    .find({
      collection: 'event-vendors',
      where: { event: { equals: eventId } },
      pagination: false,
      depth: 1,
      sort: 'arrivalAt',
      user: props.req.user,
      overrideAccess: false,
    })
    .catch(() => null)
  if (!bookings) {
    return <p style={{ margin: 0 }}>Only studio admins and production managers can see this event&apos;s vendors.</p>
  }
  const { active, confirmed, totals } = summarizeVendorCosts(bookings.docs)
  const time = new Intl.DateTimeFormat('en', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: typeof props.data?.timeZone === 'string' ? props.data.timeZone : 'Europe/Lisbon',
  })
  const cell: React.CSSProperties = { padding: '4px 12px 4px 0', textAlign: 'left', verticalAlign: 'top' }
  const add = `/admin/collections/event-vendors/create`
  const list = `/admin/collections/event-vendors?where[event][equals]=${encodeURIComponent(String(eventId))}`

  return (
    <div style={box}>
      <strong>
        {active} vendors booked, {confirmed} confirmed by the vendor
      </strong>
      {bookings.docs.length > 0 && (
        <table style={{ borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr>
              <th style={cell}>Vendor</th>
              <th style={cell}>Role</th>
              <th style={cell}>Arrives</th>
              <th style={cell}>Status</th>
              <th style={cell}>Due</th>
              <th style={cell}>Paid</th>
            </tr>
          </thead>
          <tbody>
            {bookings.docs.map((booking) => {
              const vendor = typeof booking.vendor === 'object' ? booking.vendor : null
              return (
                <tr key={booking.id}>
                  <td style={cell}>
                    <a href={`/admin/collections/event-vendors/${booking.id}`}>{vendor?.name ?? `#${idOf(booking.vendor)}`}</a>
                  </td>
                  <td style={cell}>{booking.role}</td>
                  <td style={cell}>{booking.arrivalAt ? time.format(new Date(booking.arrivalAt)) : '—'}</td>
                  <td style={cell}>{BOOKING_STATUS_LABELS[booking.status as BookingStatus]}</td>
                  <td style={cell}>{formatMoney(booking.amountDue ?? 0, booking.currency ?? 'eur', 'en')}</td>
                  <td style={cell}>{formatMoney(booking.amountPaid ?? 0, booking.currency ?? 'eur', 'en')}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
      {totals.map((t) => (
        <p key={t.currency} style={{ margin: 0 }}>
          Total {formatMoney(t.due, t.currency, 'en')}, paid {formatMoney(t.paid, t.currency, 'en')}, still to
          pay {formatMoney(t.outstanding, t.currency, 'en')}
        </p>
      ))}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <a href={add}>Book a vendor</a>
        <a href={list}>Open this event&apos;s vendor list</a>
      </div>
    </div>
  )
}
