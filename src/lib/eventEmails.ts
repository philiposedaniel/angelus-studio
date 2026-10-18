import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'

import { isLocale, type Locale } from '@/i18n/config'
import { getDictionary } from '@/i18n/dictionaries'
import { fromStudio, renderEmail, type EmailKind, type EmailMessage } from '@/lib/email'
import { formatEventWhen } from '@/lib/eventTime'
import { idOf } from '@/lib/ids'
import { tenantLocales } from '@/lib/locale'
import { siteOrigin } from '@/lib/siteOrigin'
import { runSql } from '@/lib/sqlSession'
import { offerOpen } from '@/lib/waitlist'
import type { Tenant } from '@/payload-types'

/**
 * Claims a record for sending by setting its sent time only if it is still empty, in one
 * statement, so two runs of the same job (a double click, a retry) never both send. A failed
 * send releases the claim so the retry can take it.
 */
const SENT_COLUMNS = {
  invitation: {
    claim: (id: number) =>
      sql`UPDATE event_guests SET invitation_sent_at = now() WHERE id = ${id} AND invitation_sent_at IS NULL RETURNING id`,
    release: (id: number) => sql`UPDATE event_guests SET invitation_sent_at = NULL WHERE id = ${id}`,
  },
  ticket: {
    claim: (id: number) =>
      sql`UPDATE registrations SET confirmation_sent_at = now() WHERE id = ${id} AND confirmation_sent_at IS NULL RETURNING id`,
    release: (id: number) => sql`UPDATE registrations SET confirmation_sent_at = NULL WHERE id = ${id}`,
  },
  waitlistOffer: {
    claim: (id: number) =>
      sql`UPDATE waitlist_entries SET offer_sent_at = now() WHERE id = ${id} AND offer_sent_at IS NULL RETURNING id`,
    release: (id: number) => sql`UPDATE waitlist_entries SET offer_sent_at = NULL WHERE id = ${id}`,
  },
} satisfies Record<EmailKind, { claim: (id: number) => unknown; release: (id: number) => unknown }>

const plural = (forms: { one: string; other: string }, count: number) =>
  (count === 1 ? forms.one : forms.other).replace('{count}', String(count))

type Prepared = {
  to: string
  from: string
  subject: string
  text: string
  html: string
  /** Takes the record for this send; false when another run already took it. */
  claim: () => Promise<boolean>
  /** Gives the record back after a failed send. */
  release: () => Promise<unknown>
}

async function studioAndEvent(payload: Payload, eventId: unknown) {
  const id = idOf(eventId)
  if (id === undefined || id === null) return null
  const event = await payload.findByID({ collection: 'events', id, depth: 0, overrideAccess: true }).catch(() => null)
  if (!event?.published) return null
  const tenant = await payload
    .findByID({ collection: 'tenants', id: idOf(event.tenant)!, depth: 0, overrideAccess: true })
    .catch(() => null)
  if (!tenant) return null
  return { event, tenant }
}

/** The person's language if the studio offers it, otherwise the studio's first. */
const languageFor = (tenant: Tenant, language: string | null | undefined): Locale => {
  const offered = tenantLocales(tenant)
  return isLocale(language) && offered.includes(language) ? language : offered[0]!
}

const finish = (payload: Payload, kind: EmailKind, id: number, tenant: Tenant, message: EmailMessage): Prepared => {
  const { text, html } = renderEmail(message, tenant.name)
  return {
    to: message.to,
    from: fromStudio(tenant.name),
    subject: message.subject,
    text,
    html,
    claim: async () => (await runSql(payload, SENT_COLUMNS[kind].claim(id))).length === 1,
    release: () => runSql(payload, SENT_COLUMNS[kind].release(id)),
  }
}

/**
 * Writes one email from the record as it is now, or returns null when it should not go out
 * (already sent, no address, the event unpublished, the ticket no longer confirmed, the offer
 * over). Runs in the background job, so what was true when it was queued is checked again.
 */
export async function prepareEventEmail(payload: Payload, kind: EmailKind, id: number): Promise<Prepared | null> {
  const system = { depth: 0, overrideAccess: true } as const
  if (kind === 'invitation') {
    const guest = await payload.findByID({ collection: 'event-guests', id, ...system }).catch(() => null)
    if (!guest?.email || guest.invitationSentAt || !guest.inviteToken) return null
    const found = await studioAndEvent(payload, guest.event)
    if (!found) return null
    const locale = languageFor(found.tenant, guest.language)
    const event = await payload.findByID({ collection: 'events', id: found.event.id, locale, ...system })
    const t = getDictionary(locale).emails
    const origin = await siteOrigin(payload, found.tenant.id)
    return finish(
      payload,
      kind,
      id,
      found.tenant,
      {
        to: guest.email,
        subject: t.invitation.subject.replace('{event}', event.title),
        paragraphs: [
          t.greeting.replace('{name}', guest.name),
          t.invitation.body.replace('{event}', event.title).replace('{when}', formatEventWhen(event, locale)),
          plural(t.invitation.seats, guest.partySize ?? 1),
        ],
        action: { label: t.invitation.action, url: `${origin}/${locale}/invite/${guest.inviteToken}` },
        note: t.invitation.note,
      }
    )
  }

  if (kind === 'ticket') {
    const registration = await payload.findByID({ collection: 'registrations', id, ...system }).catch(() => null)
    if (!registration || registration.status !== 'confirmed' || registration.confirmationSentAt) return null
    if (!registration.email || !registration.ticketToken) return null
    const found = await studioAndEvent(payload, registration.event)
    if (!found) return null
    const locale = languageFor(found.tenant, registration.language)
    const event = await payload.findByID({ collection: 'events', id: found.event.id, locale, ...system })
    const t = getDictionary(locale).emails
    const origin = await siteOrigin(payload, found.tenant.id)
    return finish(
      payload,
      kind,
      id,
      found.tenant,
      {
        to: registration.email,
        subject: t.ticket.subject.replace('{event}', event.title),
        paragraphs: [
          t.greeting.replace('{name}', registration.name),
          t.ticket.body.replace('{event}', event.title).replace('{when}', formatEventWhen(event, locale)),
          plural(t.ticket.places, registration.quantity ?? 1),
        ],
        action: { label: t.ticket.action, url: `${origin}/${locale}/tickets/${registration.ticketToken}` },
        note: t.ticket.note,
      }
    )
  }

  const entry = await payload.findByID({ collection: 'waitlist-entries', id, ...system }).catch(() => null)
  if (!entry || entry.offerSentAt || !offerOpen(entry) || !entry.claimToken) return null
  const found = await studioAndEvent(payload, entry.event)
  if (!found) return null
  const locale = languageFor(found.tenant, entry.language)
  const event = await payload.findByID({ collection: 'events', id: found.event.id, locale, ...system })
  const t = getDictionary(locale).emails
  const origin = await siteOrigin(payload, found.tenant.id)
  const until = new Intl.DateTimeFormat(locale, {
    dateStyle: 'full',
    timeStyle: 'short',
    timeZone: event.timeZone || 'Europe/Lisbon',
  }).format(new Date(entry.offerExpiresAt!))
  return finish(
    payload,
    kind,
    id,
    found.tenant,
    {
      to: entry.email,
      subject: t.waitlistOffer.subject.replace('{event}', event.title),
      paragraphs: [
        t.greeting.replace('{name}', entry.name),
        t.waitlistOffer.body
          .replace('{event}', event.title)
          .replace('{when}', formatEventWhen(event, locale))
          .replace('{until}', until),
      ],
      action: { label: t.waitlistOffer.action, url: `${origin}/${locale}/waitlist/${entry.claimToken}` },
      note: t.waitlistOffer.note,
    }
  )
}
