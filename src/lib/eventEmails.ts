import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'

import { isLocale, LOCALE_LABELS, type Locale } from '@/i18n/config'
import { getDictionary } from '@/i18n/dictionaries'
import { fromStudio, renderEmail, type EmailKind, type EmailMessage } from '@/lib/email'
import { formatEventWhen } from '@/lib/eventTime'
import { idOf } from '@/lib/ids'
import { tenantLocales } from '@/lib/locale'
import { describeParty, rsvpIsOpen } from '@/lib/rsvp'
import { siteOrigin } from '@/lib/siteOrigin'
import { runSql } from '@/lib/sqlSession'
import { offerOpen } from '@/lib/waitlist'
import type { Event, Tenant } from '@/payload-types'

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
  // A guest can be reminded again once a few days have passed since the last reminder.
  replyReminder: {
    claim: (id: number) =>
      sql`UPDATE event_guests SET reply_reminder_sent_at = now() WHERE id = ${id}
        AND (reply_reminder_sent_at IS NULL OR reply_reminder_sent_at < now() - ${`${REMIND_AGAIN_AFTER_DAYS} days`}::interval) RETURNING id`,
    release: (id: number) => sql`UPDATE event_guests SET reply_reminder_sent_at = NULL WHERE id = ${id}`,
  },
  // One notice per reply: a changed answer has a new reply time and is announced again.
  replyNotice: {
    claim: (id: number) =>
      sql`UPDATE event_guests SET reply_notice_sent_for = responded_at WHERE id = ${id}
        AND responded_at IS NOT NULL AND reply_notice_sent_for IS DISTINCT FROM responded_at RETURNING id`,
    release: (id: number) => sql`UPDATE event_guests SET reply_notice_sent_for = NULL WHERE id = ${id}`,
  },
  // Sent when a vendor is booked, and again on request, never twice within a minute.
  vendorBooking: {
    claim: (id: number) =>
      sql`UPDATE event_vendors SET booking_emailed_at = now() WHERE id = ${id}
        AND (booking_emailed_at IS NULL OR booking_emailed_at < now() - interval '1 minute') RETURNING id`,
    release: (id: number) => sql`UPDATE event_vendors SET booking_emailed_at = NULL WHERE id = ${id}`,
  },
  vendorConfirmed: {
    claim: (id: number) =>
      sql`UPDATE event_vendors SET confirmation_notice_sent_for = confirmed_at WHERE id = ${id}
        AND confirmed_at IS NOT NULL AND confirmation_notice_sent_for IS DISTINCT FROM confirmed_at RETURNING id`,
    release: (id: number) => sql`UPDATE event_vendors SET confirmation_notice_sent_for = NULL WHERE id = ${id}`,
  },
  guestDayBefore: {
    claim: (id: number) =>
      sql`UPDATE event_guests SET day_before_sent_at = now() WHERE id = ${id} AND day_before_sent_at IS NULL RETURNING id`,
    release: (id: number) => sql`UPDATE event_guests SET day_before_sent_at = NULL WHERE id = ${id}`,
  },
  inquiryAlert: {
    claim: (id: number) =>
      sql`UPDATE inquiries SET alert_sent_at = now() WHERE id = ${id} AND alert_sent_at IS NULL RETURNING id`,
    release: (id: number) => sql`UPDATE inquiries SET alert_sent_at = NULL WHERE id = ${id}`,
  },
  ticketDayBefore: {
    claim: (id: number) =>
      sql`UPDATE registrations SET day_before_sent_at = now() WHERE id = ${id} AND day_before_sent_at IS NULL RETURNING id`,
    release: (id: number) => sql`UPDATE registrations SET day_before_sent_at = NULL WHERE id = ${id}`,
  },
} satisfies Record<EmailKind, { claim: (id: number) => unknown; release: (id: number) => unknown }>

/** Days before a guest who still has not replied can be reminded again. */
export const REMIND_AGAIN_AFTER_DAYS = 3

/** Whether a reply reminder sent at this time still holds off another one. */
export const recentlyReminded = (sentAt: string | null | undefined, now = Date.now()) =>
  Boolean(sentAt) && now - new Date(sentAt!).getTime() < REMIND_AGAIN_AFTER_DAYS * 86_400_000

/** How far ahead of an event its day-before reminders go out. */
export const DAY_BEFORE_WINDOW_MS = 24 * 3_600_000

/** Whether the event is within a day of starting and has not started, so reminders are due. */
export const dayBeforeIsDue = (event: { startsAt: string; reminderEmails?: boolean | null }, now = Date.now()) => {
  const startsIn = new Date(event.startsAt).getTime() - now
  return event.reminderEmails !== false && startsIn > 0 && startsIn <= DAY_BEFORE_WINDOW_MS
}

const plural = (forms: { one: string; other: string }, count: number) =>
  (count === 1 ? forms.one : forms.other).replace('{count}', String(count))

type Prepared = {
  to: string | string[]
  from: string
  /** Where answers go, when that is not the studio's sending address. */
  replyTo?: string
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

/** Who hears about replies: the event's organizers and the extra address set on the event. */
async function replyNoticeRecipients(payload: Payload, event: Event): Promise<string[]> {
  const organizerIds = (event.organizers ?? []).map((organizer) => idOf(organizer)).filter((value) => value !== undefined && value !== null)
  const organizers =
    organizerIds.length > 0
      ? (
          await payload.find({
            collection: 'users',
            where: { id: { in: organizerIds } },
            pagination: false,
            depth: 0,
            select: { email: true },
            overrideAccess: true,
          })
        ).docs.map((user) => user.email)
      : []
  const addresses = [...organizers, ...(event.replyNoticeEmail ? [event.replyNoticeEmail] : [])]
  return [...new Set(addresses.filter(Boolean).map((address) => address.toLowerCase()))]
}

/** The person's language if the studio offers it, otherwise the studio's first. */
const languageFor = (tenant: Tenant, language: string | null | undefined): Locale => {
  const offered = tenantLocales(tenant)
  return isLocale(language) && offered.includes(language) ? language : offered[0]!
}

const finish = (
  payload: Payload,
  kind: EmailKind,
  id: number,
  tenant: Tenant,
  message: EmailMessage,
  to: string | string[] = message.to,
  replyTo?: string,
): Prepared => {
  const { text, html } = renderEmail(message, tenant.name)
  return {
    to,
    from: fromStudio(tenant.name),
    replyTo,
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

  if (kind === 'vendorBooking' || kind === 'vendorConfirmed') {
    const booking = await payload.findByID({ collection: 'event-vendors', id, ...system }).catch(() => null)
    if (!booking?.vendorToken) return null
    const [vendor, event0] = await Promise.all([
      payload.findByID({ collection: 'vendors', id: idOf(booking.vendor)!, ...system }).catch(() => null),
      payload.findByID({ collection: 'events', id: idOf(booking.event)!, ...system }).catch(() => null),
    ])
    if (!vendor || !event0) return null
    const tenant = await payload.findByID({ collection: 'tenants', id: idOf(event0.tenant)!, ...system }).catch(() => null)
    if (!tenant) return null
    // Vendors and studio staff read the studio's first language, as on the vendor link.
    const locale = tenantLocales(tenant)[0]!
    const event = await payload.findByID({ collection: 'events', id: event0.id, locale, ...system })
    const origin = await siteOrigin(payload, tenant.id)
    const t = getDictionary(locale).emails
    const when = formatEventWhen(event, locale)
    if (kind === 'vendorBooking') {
      if (!['booked', 'confirmed'].includes(booking.status ?? '') || !vendor.email) return null
      if (booking.bookingEmailedAt && Date.now() - new Date(booking.bookingEmailedAt).getTime() < 60_000) return null
      const arrival = booking.arrivalAt
        ? new Intl.DateTimeFormat(locale, { dateStyle: 'full', timeStyle: 'short', timeZone: event.timeZone || 'Europe/Lisbon' }).format(
            new Date(booking.arrivalAt),
          )
        : null
      return finish(payload, kind, id, tenant, {
        to: vendor.email,
        subject: t.vendorBooking.subject.replace('{event}', event.title),
        paragraphs: [
          t.greeting.replace('{name}', vendor.contactName || vendor.name),
          t.vendorBooking.body.replace('{studio}', tenant.name).replace('{event}', event.title).replace('{when}', when).replace('{role}', booking.role),
          ...(arrival ? [t.vendorBooking.arrival.replace('{arrival}', arrival)] : []),
          ...(event.location ? [t.dayBefore.where.replace('{location}', event.location)] : []),
        ],
        action: { label: t.vendorBooking.action, url: `${origin}/${locale}/vendor/${booking.vendorToken}` },
        note: t.vendorBooking.note,
      })
    }
    if (booking.status !== 'confirmed' || !booking.confirmedAt || !event.replyNoticeEmail) return null
    if (booking.confirmationNoticeSentFor && new Date(booking.confirmationNoticeSentFor).getTime() === new Date(booking.confirmedAt).getTime()) return null
    return finish(payload, kind, id, tenant, {
      to: event.replyNoticeEmail,
      subject: t.vendorConfirmed.subject.replace('{vendor}', vendor.name).replace('{event}', event.title),
      paragraphs: [
        t.vendorConfirmed.body.replace('{vendor}', vendor.name).replace('{event}', event.title).replace('{when}', when).replace('{role}', booking.role),
        ...(booking.vendorNote ? [t.vendorConfirmed.vendorNote.replace('{note}', booking.vendorNote)] : []),
      ],
      action: { label: t.vendorConfirmed.action, url: `${origin}/admin/collections/event-vendors/${booking.id}` },
      note: t.vendorConfirmed.note,
    })
  }

  if (kind === 'inquiryAlert') {
    const inquiry = await payload.findByID({ collection: 'inquiries', id, ...system }).catch(() => null)
    if (!inquiry || inquiry.alertSentAt) return null
    const tenant = await payload.findByID({ collection: 'tenants', id: idOf(inquiry.tenant)!, ...system }).catch(() => null)
    if (!tenant) return null
    const settings = (
      await payload.find({ collection: 'site-settings', where: { tenant: { equals: tenant.id } }, limit: 1, ...system })
    ).docs[0]
    const to = settings?.contact?.email
    if (!to || settings.contact?.inquiryAlerts === false) return null
    // Staff read the studio's first language; the inquiry says which one the visitor wrote in.
    const locale = tenantLocales(tenant)[0]!
    const dictionary = getDictionary(locale)
    const t = dictionary.emails.inquiryAlert
    const origin = await siteOrigin(payload, tenant.id)
    const eventDate = inquiry.eventDate
      ? new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(inquiry.eventDate))
      : null
    // Worth saying only when the visitor wrote in another language than this email's.
    const language = isLocale(inquiry.locale) && inquiry.locale !== locale ? LOCALE_LABELS[inquiry.locale] : null
    return finish(
      payload,
      kind,
      id,
      tenant,
      {
        to,
        subject: t.subject.replace('{name}', inquiry.name),
        paragraphs: [
          t.body.replace('{name}', inquiry.name),
          t.type.replace('{type}', dictionary.inquiry.eventTypes[inquiry.eventType]),
          ...(eventDate ? [t.date.replace('{date}', eventDate)] : []),
          ...(inquiry.location ? [t.location.replace('{location}', inquiry.location)] : []),
          t.contact.replace('{email}', inquiry.email) + (inquiry.phone ? ` · ${inquiry.phone}` : ''),
          ...(language ? [t.language.replace('{language}', language)] : []),
          inquiry.message,
        ],
        action: { label: t.action, url: `${origin}/admin/collections/inquiries/${inquiry.id}` },
        note: t.note.replace('{name}', inquiry.name),
      },
      to,
      inquiry.email,
    )
  }

  if (kind === 'replyNotice') {
    const guest = await payload.findByID({ collection: 'event-guests', id, ...system }).catch(() => null)
    if (!guest?.respondedAt || guest.rsvpStatus === 'pending') return null
    if (guest.replyNoticeSentFor && new Date(guest.replyNoticeSentFor).getTime() === new Date(guest.respondedAt).getTime()) return null
    const found = await studioAndEvent(payload, guest.event)
    if (!found || found.event.replyNotices === false) return null
    const recipients = await replyNoticeRecipients(payload, found.event)
    if (recipients.length === 0) return null
    // Hosts may speak different languages; the notice uses the studio's first one.
    const locale = tenantLocales(found.tenant)[0]!
    const event = await payload.findByID({ collection: 'events', id: found.event.id, locale, ...system })
    const t = getDictionary(locale).emails.replyNotice
    const origin = await siteOrigin(payload, found.tenant.id)
    const mealLabels = new Map((event.mealOptions ?? []).map((option) => [option.id, option.label]))
    const party =
      guest.rsvpStatus === 'attending'
        ? describeParty(guest, (mealId) => mealLabels.get(mealId), (n) => t.guestNumber.replace('{n}', String(n)))
        : ''
    return finish(
      payload,
      kind,
      id,
      found.tenant,
      {
        to: recipients[0]!,
        subject: t.subject.replace('{name}', guest.name).replace('{event}', event.title),
        paragraphs: [
          t.body.replace('{name}', guest.name).replace('{event}', event.title),
          guest.rsvpStatus === 'attending' ? plural(t.attending, guest.attendingCount ?? 1) : t.declined,
          ...(party ? [t.party.replace('{party}', party)] : []),
          ...(guest.rsvpStatus === 'attending' && guest.dietaryNotes ? [t.dietary.replace('{notes}', guest.dietaryNotes)] : []),
          ...(guest.guestMessage ? [t.message.replace('{message}', guest.guestMessage)] : []),
        ],
        action: { label: t.action, url: `${origin}/${locale}/portal/events/${event.id}` },
        note: t.note,
      },
      recipients,
    )
  }

  if (kind === 'replyReminder' || kind === 'guestDayBefore') {
    const guest = await payload.findByID({ collection: 'event-guests', id, ...system }).catch(() => null)
    if (!guest?.email || !guest.inviteToken) return null
    const found = await studioAndEvent(payload, guest.event)
    if (!found) return null
    if (kind === 'replyReminder') {
      // Only guests who have not answered, while they still can.
      if (guest.rsvpStatus !== 'pending' || recentlyReminded(guest.replyReminderSentAt) || !rsvpIsOpen(found.event)) return null
    } else if (guest.rsvpStatus !== 'attending' || guest.dayBeforeSentAt || !dayBeforeIsDue(found.event)) return null
    const locale = languageFor(found.tenant, guest.language)
    const event = await payload.findByID({ collection: 'events', id: found.event.id, locale, ...system })
    const t = getDictionary(locale).emails
    const origin = await siteOrigin(payload, found.tenant.id)
    const url = `${origin}/${locale}/invite/${guest.inviteToken}`
    const when = formatEventWhen(event, locale)
    if (kind === 'replyReminder') {
      const deadline = event.rsvpDeadline
        ? new Intl.DateTimeFormat(locale, { dateStyle: 'full', timeStyle: 'short', timeZone: event.timeZone || 'Europe/Lisbon' }).format(
            new Date(event.rsvpDeadline),
          )
        : null
      return finish(payload, kind, id, found.tenant, {
        to: guest.email,
        subject: t.replyReminder.subject.replace('{event}', event.title),
        paragraphs: [
          t.greeting.replace('{name}', guest.name),
          t.replyReminder.body.replace('{event}', event.title).replace('{when}', when),
          ...(deadline ? [t.replyReminder.deadline.replace('{deadline}', deadline)] : []),
        ],
        action: { label: t.replyReminder.action, url },
        note: t.invitation.note,
      })
    }
    return finish(payload, kind, id, found.tenant, {
      to: guest.email,
      subject: t.dayBefore.subject.replace('{event}', event.title),
      paragraphs: [
        t.greeting.replace('{name}', guest.name),
        t.dayBefore.body.replace('{event}', event.title).replace('{when}', when),
        ...(event.location ? [t.dayBefore.where.replace('{location}', event.location)] : []),
        t.dayBefore.guestCode,
      ],
      action: { label: t.dayBefore.guestAction, url },
      note: t.invitation.note,
    })
  }

  if (kind === 'ticketDayBefore') {
    const registration = await payload.findByID({ collection: 'registrations', id, ...system }).catch(() => null)
    if (!registration || registration.status !== 'confirmed' || registration.dayBeforeSentAt) return null
    if (!registration.email || !registration.ticketToken) return null
    const found = await studioAndEvent(payload, registration.event)
    if (!found || !dayBeforeIsDue(found.event)) return null
    const locale = languageFor(found.tenant, registration.language)
    const event = await payload.findByID({ collection: 'events', id: found.event.id, locale, ...system })
    const t = getDictionary(locale).emails
    const origin = await siteOrigin(payload, found.tenant.id)
    return finish(payload, kind, id, found.tenant, {
      to: registration.email,
      subject: t.dayBefore.subject.replace('{event}', event.title),
      paragraphs: [
        t.greeting.replace('{name}', registration.name),
        t.dayBefore.body.replace('{event}', event.title).replace('{when}', formatEventWhen(event, locale)),
        ...(event.location ? [t.dayBefore.where.replace('{location}', event.location)] : []),
        plural(t.ticket.places, registration.quantity ?? 1),
      ],
      action: { label: t.ticket.action, url: `${origin}/${locale}/tickets/${registration.ticketToken}` },
      note: t.ticket.note,
    })
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
