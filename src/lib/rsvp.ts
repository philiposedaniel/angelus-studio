import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'

import { idOf } from '@/lib/ids'
import { MAX_PARTY_SIZE, RSVP_LIMITS } from '@/lib/rsvpLimits'
import { isShareToken } from '@/lib/shareTokens'
import { runSql } from '@/lib/sqlSession'
import type { Event, EventGuest } from '@/payload-types'

export const RSVP_STATUSES = ['pending', 'attending', 'declined'] as const
export type RsvpStatus = (typeof RSVP_STATUSES)[number]

export { MAX_PARTY_SIZE, RSVP_LIMITS }

/** Most meals an event can offer to choose from. */
export const MAX_MEAL_OPTIONS = 12

export type RsvpField =
  | 'response'
  | 'attendingCount'
  | 'dietaryNotes'
  | 'guestMessage'
  | `party.${number}.name`
  | `party.${number}.meal`
export type RsvpFieldError = 'required' | 'invalid' | 'tooLong' | 'chooseMeal'

/** One person coming on an invitation: the guest first, then whoever they bring. */
export type RsvpPerson = { name: string | null; meal: string | null }

export type RsvpState =
  | { status: 'idle' }
  | { status: 'saved'; response: 'attending' | 'declined' }
  | {
      status: 'error'
      errors?: Partial<Record<RsvpField, RsvpFieldError>>
      reason?: 'closed' | 'failed'
    }

export type RsvpInput = {
  response: 'attending' | 'declined'
  attendingCount: number
  dietaryNotes: string
  guestMessage: string
  /** Each person coming, when the invitation is for more than one or the event offers meals. */
  party: RsvpPerson[]
}

/** The ids of the meals an event offers, in order. */
export const mealOptionIds = (event: Pick<Event, 'mealOptions'>): string[] =>
  (event.mealOptions ?? []).flatMap((option) => (option.id ? [option.id] : []))

/** Whether the reply asks who is coming: a party of more than one, or a meal to choose. */
export const asksForParty = (partySize: number, mealIds: readonly string[]) => partySize > 1 || mealIds.length > 0

const text = (form: FormData, key: string) => {
  const value = form.get(key)
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * Checks a guest's answer against the seats on their invitation and the meals the event offers.
 * The first person is the guest; the others' names are optional, a meal is required for each
 * person when the event offers meals.
 */
export function validateRsvp(
  form: FormData,
  partySize: number,
  mealIds: readonly string[] = [],
): { ok: true; input: RsvpInput } | { ok: false; errors: Partial<Record<RsvpField, RsvpFieldError>> } {
  const errors: Partial<Record<RsvpField, RsvpFieldError>> = {}
  const response = text(form, 'response')
  const dietaryNotes = text(form, 'dietaryNotes')
  const guestMessage = text(form, 'guestMessage')

  if (response !== 'attending' && response !== 'declined') errors.response = 'required'
  let attendingCount = 0
  if (response === 'attending') {
    const raw = text(form, 'attendingCount') || '1'
    attendingCount = /^\d+$/.test(raw) ? Number(raw) : NaN
    if (!Number.isInteger(attendingCount) || attendingCount < 1 || attendingCount > partySize) {
      errors.attendingCount = 'invalid'
    }
  }
  const party: RsvpPerson[] = []
  if (response === 'attending' && !errors.attendingCount && asksForParty(partySize, mealIds)) {
    for (let i = 0; i < attendingCount; i++) {
      // The guest's own name comes from the invitation, not the form.
      const name = i === 0 ? '' : text(form, `party.${i}.name`)
      const meal = text(form, `party.${i}.meal`)
      if (name.length > RSVP_LIMITS.personName) errors[`party.${i}.name`] = 'tooLong'
      if (mealIds.length > 0 && !mealIds.includes(meal)) errors[`party.${i}.meal`] = 'chooseMeal'
      party.push({ name: name || null, meal: mealIds.length > 0 ? meal : null })
    }
  }
  if (dietaryNotes.length > RSVP_LIMITS.dietaryNotes) errors.dietaryNotes = 'tooLong'
  if (guestMessage.length > RSVP_LIMITS.guestMessage) errors.guestMessage = 'tooLong'

  if (Object.keys(errors).length > 0) return { ok: false, errors }
  return {
    ok: true,
    input: {
      response: response as RsvpInput['response'],
      attendingCount,
      // A guest who is not coming has no seats and no meal to plan.
      dietaryNotes: response === 'attending' ? dietaryNotes : '',
      guestMessage,
      party,
    },
  }
}

/** Whether guests may still answer: replies open on the event and the deadline not passed. */
export const rsvpIsOpen = (
  event: Pick<Event, 'rsvpOpen' | 'rsvpDeadline'>,
  now = Date.now(),
): boolean =>
  event.rsvpOpen !== false && (!event.rsvpDeadline || new Date(event.rsvpDeadline).getTime() >= now)

/**
 * Finds the invitation behind a link: the guest, on this studio's site, for a published event.
 * Visitors have no access to guests; the token and the site's studio are the only keys.
 */
export async function findInvitation(
  payload: Payload,
  tenantId: number,
  token: unknown,
): Promise<{ guest: EventGuest; event: Event } | null> {
  if (!isShareToken(token)) return null
  const { docs } = await payload.find({
    collection: 'event-guests',
    where: { and: [{ tenant: { equals: tenantId } }, { inviteToken: { equals: token } }] },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })
  const guest = docs[0]
  const eventId = idOf(guest?.event)
  if (!guest || eventId === undefined) return null
  const event = await payload
    .findByID({ collection: 'events', id: eventId, depth: 0, overrideAccess: true })
    .catch(() => null)
  if (!event || !event.published || String(idOf(event.tenant)) !== String(tenantId)) return null
  return { guest, event }
}

/** Saves a guest's answer after every check. Used by the invitation page's server action. */
export async function submitRsvp({
  payload,
  tenantId,
  form,
  now = Date.now(),
}: {
  payload: Payload
  tenantId: number
  form: FormData
  now?: number
}): Promise<RsvpState> {
  const found = await findInvitation(payload, tenantId, form.get('token'))
  if (!found) return { status: 'error', reason: 'failed' }
  const { guest, event } = found
  if (!rsvpIsOpen(event, now)) return { status: 'error', reason: 'closed' }

  const result = validateRsvp(form, guest.partySize ?? 1, mealOptionIds(event))
  if (!result.ok) return { status: 'error', errors: result.errors }

  try {
    // System write: guests have no update access; the invitation token stands in for it.
    await payload.update({
      collection: 'event-guests',
      id: guest.id,
      data: {
        rsvpStatus: result.input.response,
        attendingCount: result.input.attendingCount,
        dietaryNotes: result.input.dietaryNotes,
        guestMessage: result.input.guestMessage,
        party: result.input.party.map((person, i) => ({ ...person, name: i === 0 ? guest.name : person.name })),
        respondedAt: new Date(now).toISOString(),
      },
      overrideAccess: true,
    })
  } catch (error) {
    payload.logger.error({ err: error, msg: 'Could not save an RSVP' })
    return { status: 'error', reason: 'failed' }
  }
  return { status: 'saved', response: result.input.response }
}

/** Headcount for an event's guest list. */
export function summarizeRsvps(
  guests: readonly (Pick<EventGuest, 'rsvpStatus' | 'attendingCount' | 'partySize' | 'checkedInCount'> & {
    /** How many invitations the row stands for, when guests come grouped (see `eventRsvpSummary`). */
    invitations?: number
  })[],
) {
  const summary = { invitations: 0, seats: 0, attending: 0, declined: 0, pending: 0, headcount: 0, arrived: 0 }
  for (const guest of guests) {
    const count = guest.invitations ?? 1
    summary.invitations += count
    summary.seats += guest.partySize ?? count
    summary.arrived += guest.checkedInCount ?? 0
    if (guest.rsvpStatus === 'attending') {
      summary.attending += count
      summary.headcount += guest.attendingCount ?? 0
    } else if (guest.rsvpStatus === 'declined') summary.declined += count
    else summary.pending += count
  }
  return summary
}

/**
 * The headcount for a whole event, added up in the database so a guest list of thousands does
 * not have to be loaded. The caller must already have checked the user may see this event's
 * guests: the sum reads past access rules, by event id only.
 */
export async function eventRsvpSummary(payload: Payload, eventId: number | string) {
  const rows = await runSql<{ status: string; invitations: string; seats: string; coming: string; arrived: string }>(
    payload,
    sql`SELECT rsvp_status AS status, COUNT(*) AS invitations, COALESCE(SUM(party_size), 0) AS seats,
        COALESCE(SUM(attending_count), 0) AS coming, COALESCE(SUM(checked_in_count), 0) AS arrived
      FROM event_guests WHERE event_id = ${Number(eventId)} GROUP BY rsvp_status`,
  )
  return summarizeRsvps(
    rows.map((row) => ({
      rsvpStatus: row.status as RsvpStatus,
      invitations: Number(row.invitations),
      partySize: Number(row.seats),
      attendingCount: Number(row.coming),
      checkedInCount: Number(row.arrived),
    })),
  )
}

/**
 * How many people coming chose each meal, added up in the database. Like `eventRsvpSummary`,
 * the caller must already have checked the user may see this event's guests.
 */
export async function eventMealCounts(payload: Payload, eventId: number | string): Promise<Map<string, number>> {
  const rows = await runSql<{ meal: string; people: string }>(
    payload,
    sql`SELECT p.meal AS meal, COUNT(*) AS people
      FROM event_guests_party p JOIN event_guests g ON g.id = p._parent_id
      WHERE g.event_id = ${Number(eventId)} AND g.rsvp_status = 'attending' AND p.meal IS NOT NULL
      GROUP BY p.meal`,
  )
  return new Map(rows.map((row) => [row.meal, Number(row.people)]))
}

/**
 * Each meal the event offers with how many chose it, in the event's order, and how many people
 * coming have no choice yet (or chose a meal since removed). Empty when the event offers no meals.
 */
export function summarizeMeals(
  event: Pick<Event, 'mealOptions'>,
  counts: ReadonlyMap<string, number>,
  headcount: number,
): { meals: { id: string; label: string; count: number }[]; notChosen: number } {
  const meals = (event.mealOptions ?? []).flatMap((option) =>
    option.id ? [{ id: option.id, label: option.label, count: counts.get(option.id) ?? 0 }] : [],
  )
  const chosen = meals.reduce((sum, meal) => sum + meal.count, 0)
  return { meals, notChosen: meals.length > 0 ? Math.max(0, headcount - chosen) : 0 }
}

/** A guest's party as one line, e.g. "Maria Silva (Fish), João Silva (Vegetarian), Guest 3". */
export function describeParty(
  guest: Pick<EventGuest, 'party'>,
  mealLabel: (id: string) => string | undefined,
  unnamed: (position: number) => string,
): string {
  return (guest.party ?? [])
    .map((person, i) => {
      const meal = person.meal ? mealLabel(person.meal) : undefined
      const name = person.name || unnamed(i + 1)
      return meal ? `${name} (${meal})` : name
    })
    .join(', ')
}
