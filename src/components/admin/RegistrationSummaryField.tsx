import type { UIFieldServerProps } from 'payload'

import { summarizeTickets } from '@/lib/tickets'

/** Places taken and checked in per ticket type, for the staff who manage registrations. */
export async function RegistrationSummaryField(props: UIFieldServerProps) {
  const eventId = props.id ?? props.data?.id
  const box: React.CSSProperties = { display: 'grid', gap: 8, marginBottom: 24 }
  if (eventId === undefined || eventId === null) {
    return (
      <div style={box}>
        <p style={{ margin: 0 }}>Save the event, then add ticket types under Events → Ticket types.</p>
      </div>
    )
  }
  const query = { user: props.req.user, overrideAccess: false, pagination: false, depth: 0 } as const
  const [ticketTypes, registrations, waitlist] = await Promise.all([
    props.payload
      .find({ collection: 'ticket-types', where: { event: { equals: eventId } }, sort: 'sortOrder', ...query })
      .catch(() => null),
    props.payload
      .find({
        collection: 'registrations',
        where: { event: { equals: eventId } },
        select: { ticketType: true, quantity: true, status: true, checkedInCount: true, holdExpiresAt: true },
        ...query,
      })
      .catch(() => null),
    props.payload
      .find({
        collection: 'waitlist-entries',
        where: { and: [{ event: { equals: eventId } }, { status: { in: ['waiting', 'offered'] } }] },
        select: { ticketType: true, status: true },
        ...query,
      })
      .catch(() => null),
  ])
  if (!ticketTypes || !registrations) {
    return (
      <div style={box}>
        <p style={{ margin: 0 }}>Only studio admins and production managers can see registrations.</p>
      </div>
    )
  }
  const filter = `where[event][equals]=${encodeURIComponent(String(eventId))}`
  const links = (
    <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
      <a href={`/admin/collections/ticket-types/create`}>Add a ticket type</a>
      <a href={`/admin/collections/ticket-types?${filter}`}>This event&apos;s ticket types</a>
      <a href={`/admin/collections/registrations?${filter}`}>This event&apos;s registrations</a>
      <a href={`/admin/collections/waitlist-entries?${filter}`}>This event&apos;s waitlist</a>
      <a href={`/api/registrations/export?event=${encodeURIComponent(String(eventId))}`} download>
        Download the attendee list (CSV)
      </a>
    </div>
  )
  if (ticketTypes.docs.length === 0) {
    return (
      <div style={box}>
        <p style={{ margin: 0 }}>
          No ticket types yet. Add one to let people register on the event page (the event must be
          published and shown on the website).
        </p>
        {links}
      </div>
    )
  }
  const rows = summarizeTickets(ticketTypes.docs, registrations.docs, waitlist?.docs ?? [])
  const cell: React.CSSProperties = { padding: '4px 12px 4px 0', textAlign: 'left' }

  return (
    <div style={box}>
      <strong>Registrations</strong>
      <table style={{ borderCollapse: 'collapse', fontSize: 14 }}>
        <thead>
          <tr>
            <th style={cell}>Ticket</th>
            <th style={cell}>Places taken</th>
            <th style={cell}>Left</th>
            <th style={cell}>Checked in</th>
            <th style={cell}>Waitlist</th>
            <th style={cell}>On sale</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td style={cell}>{row.name}</td>
              <td style={cell}>
                {row.taken} of {row.capacity} ({row.registrations} registrations
                {row.waiting > 0 ? `, ${row.waiting} places waiting for payment` : ''})
              </td>
              <td style={cell}>{row.left}</td>
              <td style={cell}>{row.arrived}</td>
              <td style={cell}>{row.onWaitlist}</td>
              <td style={cell}>{row.onSale ? 'Yes' : 'No'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {links}
    </div>
  )
}
