import type { UIFieldServerProps } from 'payload'

import { summarizeRsvps } from '@/lib/rsvp'

/** The event's headcount from its guest list, for the people allowed to see guests. */
export async function RsvpSummaryField(props: UIFieldServerProps) {
  const eventId = props.id ?? props.data?.id
  const box: React.CSSProperties = { display: 'grid', gap: 8, marginBottom: 24 }
  if (eventId === undefined || eventId === null) {
    return (
      <div style={box}>
        <p style={{ margin: 0 }}>Save the event, then add guests under Events → Guests.</p>
      </div>
    )
  }
  const guests = await props.payload
    .find({
      collection: 'event-guests',
      where: { event: { equals: eventId } },
      pagination: false,
      depth: 0,
      select: { rsvpStatus: true, attendingCount: true, partySize: true },
      user: props.req.user,
      overrideAccess: false,
    })
    .catch(() => null)
  if (!guests) {
    return (
      <div style={box}>
        <p style={{ margin: 0 }}>Only studio admins and production managers can see the guest list.</p>
      </div>
    )
  }
  const s = summarizeRsvps(guests.docs)
  const cell: React.CSSProperties = { padding: '4px 12px 4px 0' }

  return (
    <div style={box}>
      <strong>Replies</strong>
      <table style={{ borderCollapse: 'collapse', fontSize: 14 }}>
        <tbody>
          <tr>
            <td style={cell}>Invitations</td>
            <td style={cell}>{s.invitations} ({s.seats} seats)</td>
          </tr>
          <tr>
            <td style={cell}>Attending</td>
            <td style={cell}>
              {s.attending} ({s.headcount} people)
            </td>
          </tr>
          <tr>
            <td style={cell}>Not attending</td>
            <td style={cell}>{s.declined}</td>
          </tr>
          <tr>
            <td style={cell}>Not answered</td>
            <td style={cell}>{s.pending}</td>
          </tr>
        </tbody>
      </table>
      <a href={`/admin/collections/event-guests?where[event][equals]=${encodeURIComponent(String(eventId))}`}>
        Open this event&apos;s guest list
      </a>
    </div>
  )
}
