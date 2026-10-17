import type { UIFieldServerProps } from 'payload'

import { seatsNeeded, summarizeSeating } from '@/lib/seating'

/** The event's tables with who sits at each, and the guests still without a table. */
export async function SeatingPlanField(props: UIFieldServerProps) {
  const eventId = props.id ?? props.data?.id
  const box: React.CSSProperties = { display: 'grid', gap: 12, marginBottom: 24 }
  if (eventId === undefined || eventId === null) {
    return <p style={{ margin: 0 }}>Save the event, then add its tables under Events → Tables.</p>
  }
  const query = { where: { event: { equals: eventId } }, pagination: false, depth: 0, user: props.req.user, overrideAccess: false } as const
  const [tables, guests] = await Promise.all([
    props.payload.find({ collection: 'event-tables', ...query, sort: 'sortOrder' }).catch(() => null),
    props.payload
      .find({
        collection: 'event-guests',
        ...query,
        sort: 'name',
        select: { name: true, table: true, rsvpStatus: true, attendingCount: true, partySize: true },
      })
      .catch(() => null),
  ])
  if (!tables || !guests) {
    return <p style={{ margin: 0 }}>Only studio admins and production managers can see the seating plan.</p>
  }
  const plan = summarizeSeating(tables.docs, guests.docs)
  const id = encodeURIComponent(String(eventId))
  const card: React.CSSProperties = {
    border: '1px solid var(--theme-elevation-150)',
    borderRadius: 4,
    padding: '8px 12px',
    minWidth: 180,
  }
  const guestLine = (guest: (typeof plan.unseated)[number]) => {
    const seats = seatsNeeded(guest)
    const answer = guest.rsvpStatus === 'attending' ? '' : guest.rsvpStatus === 'declined' ? ', not coming' : ', not answered'
    return `${guest.name} (${seats}${answer})`
  }

  return (
    <div style={box}>
      <strong>
        {plan.tables.length} tables, {plan.seated} of {plan.capacity} seats taken
        {plan.unseatedSeats > 0 ? `, ${plan.unseatedSeats} people without a table` : ''}
      </strong>
      {plan.tables.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          {plan.tables.map((table) => (
            <div key={table.id} style={card}>
              <a href={`/admin/collections/event-tables/${table.id}`}>
                <strong>{table.name}</strong>
              </a>
              <div style={{ fontSize: 13, color: table.over ? 'var(--theme-error-500)' : 'var(--theme-elevation-500)' }}>
                {table.seats} of {table.capacity} seats{table.over ? ', over capacity' : ''}
              </div>
              <ul style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: 13 }}>
                {table.guests.map((guest) => (
                  <li key={guest.id}>
                    <a href={`/admin/collections/event-guests/${guest.id}`}>{guestLine(guest)}</a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
      {plan.unseated.length > 0 && (
        <div>
          <strong style={{ fontSize: 14 }}>Without a table</strong>
          <ul style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: 13 }}>
            {plan.unseated.map((guest) => (
              <li key={guest.id}>
                <a href={`/admin/collections/event-guests/${guest.id}`}>{guestLine(guest)}</a>
              </li>
            ))}
          </ul>
        </div>
      )}
      <p style={{ margin: 0, fontSize: 13 }}>
        Seat a guest by choosing their table on the guest, or select several guests in the list and use Edit to
        seat them together. People not yet answered count with every seat on their invitation.
      </p>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <a href={`/admin/collections/event-tables/create`}>Add a table</a>
        <a href={`/admin/collections/event-tables?where[event][equals]=${id}`}>Open this event&apos;s tables</a>
      </div>
    </div>
  )
}
