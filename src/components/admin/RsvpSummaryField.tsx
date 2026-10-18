import type { UIFieldServerProps } from 'payload'

import { SendInvitationsButton } from '@/components/admin/SendInvitationsButton'
import { emailConfigured } from '@/lib/email'
import { eventRsvpSummary } from '@/lib/rsvp'

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
  // Reading the event and counting its guests as the signed-in user checks they may see them;
  // the totals are then added up in the database rather than loading every guest.
  const access = { user: props.req.user, overrideAccess: false } as const
  const allowed = await Promise.all([
    props.payload.findByID({ collection: 'events', id: eventId, depth: 0, select: { title: true }, ...access }),
    props.payload.count({ collection: 'event-guests', where: { event: { equals: eventId } }, ...access }),
  ])
    .then(() => true)
    .catch(() => false)
  if (!allowed) {
    return (
      <div style={box}>
        <p style={{ margin: 0 }}>Only studio admins and production managers can see the guest list.</p>
      </div>
    )
  }
  const s = await eventRsvpSummary(props.payload, eventId)
  const event = await props.payload.findByID({ collection: 'events', id: eventId, depth: 0, select: { published: true }, ...access })
  // Guests with an email address who have not been emailed their invitation yet.
  const notEmailed = emailConfigured()
    ? (
        await props.payload.count({
          collection: 'event-guests',
          where: {
            and: [
              { event: { equals: eventId } },
              { email: { exists: true } },
              { email: { not_equals: '' } },
              { invitationSentAt: { exists: false } },
            ],
          },
          ...access,
        })
      ).totalDocs
    : 0
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
          <tr>
            <td style={cell}>Checked in</td>
            <td style={cell}>{s.arrived} people</td>
          </tr>
        </tbody>
      </table>
      {!emailConfigured() ? (
        <p style={{ margin: 0 }}>
          Invitations can be emailed once email sending is set up. Until then, copy each guest&apos;s invitation link.
        </p>
      ) : !event.published ? (
        <p style={{ margin: 0 }}>Publish the event to email its invitations.</p>
      ) : (
        <SendInvitationsButton eventId={eventId} waiting={notEmailed} />
      )}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <a href={`/admin/collections/event-guests?where[event][equals]=${encodeURIComponent(String(eventId))}`}>
          Open this event&apos;s guest list
        </a>
        <a href={`/api/event-guests/export?event=${encodeURIComponent(String(eventId))}`} download>
          Download the guest list (CSV)
        </a>
      </div>
    </div>
  )
}
