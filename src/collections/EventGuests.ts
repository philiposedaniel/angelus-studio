import { APIError, Forbidden, type Access, type CollectionConfig, type FieldAccess, type Where } from 'payload'

import { isSuperAdmin, tenantIdsWithRole } from '@/access'
import { DEFAULT_LOCALE, LOCALE_LABELS, LOCALES } from '@/i18n/config'
import { exportGuestList, importGuestList, sendInvitations, sendReplyReminders } from '@/lib/guestListEndpoints'
import { idOf } from '@/lib/ids'
import { GUEST_LIST_STAFF_ROLES, isGuestListStaff, organizedEventIds } from '@/lib/organizers'
import { MAX_PARTY_SIZE, mealOptionIds, RSVP_LIMITS, RSVP_STATUSES } from '@/lib/rsvp'
import { newShareToken } from '@/lib/shareTokens'

/** Staff who manage guest lists. Guest names, contacts and dietary needs are personal data. */
export const EVENT_GUEST_STAFF_ROLES = GUEST_LIST_STAFF_ROLES

/**
 * Studio staff see their studios' guests; an event's organizers see that event's guests.
 */
const staffOrOrganizers: Access = async ({ req }) => {
  const { user } = req
  if (!user) return false
  if (isSuperAdmin(user)) return true
  const staffOf = tenantIdsWithRole(user, EVENT_GUEST_STAFF_ROLES)
  const organized = await organizedEventIds(req.payload, user, req)
  const allowed: Where[] = [
    ...(staffOf.length > 0 ? [{ tenant: { in: staffOf } }] : []),
    ...(organized.length > 0 ? [{ event: { in: organized } }] : []),
  ]
  if (allowed.length === 0) return false
  return allowed.length === 1 ? allowed[0]! : { or: allowed }
}

/** Staff only, for fields organizers do not see. */
const staffField: FieldAccess = ({ req: { user }, doc, data }) =>
  isGuestListStaff(user, idOf(doc?.tenant ?? data?.tenant))

const isWholeNumber = (value: unknown, min: number, max: number) =>
  typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max

/**
 * One invitation to an event: a guest and the seats for their party. The guest opens their
 * personal link (`/<language>/invite/<inviteToken>`) and answers; the invitation page's server
 * action saves the answer (src/lib/rsvp.ts), so guests never use this API.
 */
export const EventGuests: CollectionConfig = {
  slug: 'event-guests',
  labels: { singular: 'Guest', plural: 'Guests' },
  admin: {
    useAsTitle: 'name',
    defaultColumns: ['name', 'event', 'partySize', 'rsvpStatus', 'attendingCount', 'group', 'table'],
    group: 'Events',
    listSearchableFields: ['name', 'email', 'group'],
  },
  defaultSort: 'name',
  access: {
    read: staffOrOrganizers,
    create: staffOrOrganizers,
    update: staffOrOrganizers,
    delete: staffOrOrganizers,
  },
  endpoints: [
    { path: '/export', method: 'get', handler: exportGuestList },
    { path: '/import', method: 'post', handler: importGuestList },
    { path: '/send-invitations', method: 'post', handler: sendInvitations },
    { path: '/send-reminders', method: 'post', handler: sendReplyReminders },
  ],
  hooks: {
    beforeValidate: [
      // A guest always belongs to the same studio as their event.
      async ({ data, originalDoc, req }) => {
        const eventId = idOf(data?.event ?? originalDoc?.event)
        if (!data || eventId === undefined) return data
        const event = await req.payload
          .findByID({ collection: 'events', id: eventId, depth: 0, req, overrideAccess: true })
          .catch(() => null)
        if (!event) throw new APIError('This event does not exist.', 400)
        data.tenant = idOf(event.tenant)

        // A guest can only sit at one of their own event's tables.
        const tableId = idOf(data.table === undefined ? originalDoc?.table : data.table)
        if (tableId !== undefined && tableId !== null) {
          const table = await req.payload
            .findByID({ collection: 'event-tables', id: tableId, depth: 0, req, overrideAccess: true })
            .catch(() => null)
          if (!table || String(idOf(table.event)) !== String(eventId)) {
            throw new APIError('Choose one of this event\'s tables.', 400)
          }
        }
        return data
      },
    ],
    beforeChange: [
      async ({ data, originalDoc, operation, req }) => {
        // Staff may only put guests on their own studio's events, organizers only on their own events.
        const { user } = req
        if (user && !isGuestListStaff(user, idOf(data.tenant))) {
          const eventId = idOf(data.event ?? originalDoc?.event)
          const organized = await organizedEventIds(req.payload, user, req)
          if (!organized.some((id) => String(id) === String(eventId))) throw new Forbidden(req.t)
        }

        const partySize: number = data.partySize ?? originalDoc?.partySize ?? 1
        const status = data.rsvpStatus ?? originalDoc?.rsvpStatus ?? 'pending'
        let attendingCount: number = data.attendingCount ?? originalDoc?.attendingCount ?? 0
        if (status !== 'attending') attendingCount = 0
        else if (attendingCount < 1) attendingCount = 1
        if (attendingCount > partySize) {
          throw new APIError('More people are attending than this invitation has seats for.', 400)
        }

        // The people coming: never more than are attending, and none when not attending. A meal
        // the event no longer offers is cleared rather than refusing the whole change.
        type Person = { id?: string | null; name?: string | null; meal?: string | null }
        let party: Person[] = status === 'attending' ? (data.party ?? originalDoc?.party ?? []) : []
        if (party.length > attendingCount) {
          throw new APIError('More people are named than are attending. Remove a name or raise the number attending.', 400)
        }
        if (party.some((person) => person.meal)) {
          const event = await req.payload
            .findByID({ collection: 'events', id: idOf(data.event ?? originalDoc?.event)!, depth: 0, req, overrideAccess: true })
            .catch(() => null)
          const offered = event ? mealOptionIds(event) : []
          party = party.map((person) => (person.meal && !offered.includes(person.meal) ? { ...person, meal: null } : person))
        }

        const checkedInCount: number = data.checkedInCount ?? originalDoc?.checkedInCount ?? 0
        if (checkedInCount > partySize) {
          throw new APIError('More people are checked in than this invitation has seats for.', 400)
        }
        // The arrival time is kept from the first check-in and cleared when it is undone.
        const checkedInAt =
          checkedInCount === 0
            ? null
            : (data.checkedInAt ?? originalDoc?.checkedInAt ?? new Date().toISOString())

        return {
          ...data,
          attendingCount,
          party,
          checkedInCount,
          checkedInAt,
          // Set on create, kept on change, never taken from the request.
          inviteToken:
            operation === 'create' || !originalDoc?.inviteToken ? newShareToken() : originalDoc.inviteToken,
        }
      },
    ],
  },
  fields: [
    {
      name: 'event',
      type: 'relationship',
      relationTo: 'events',
      required: true,
      index: true,
      filterOptions: ({ data }) => (data?.tenant ? { tenant: { equals: data.tenant } } : true),
    },
    { name: 'name', type: 'text', required: true, maxLength: 120 },
    { name: 'email', type: 'email', index: true },
    { name: 'phone', type: 'text', maxLength: 40 },
    {
      name: 'group',
      type: 'text',
      maxLength: 80,
      admin: { description: 'Optional, to sort the list, e.g. "Bride\'s family" or "Sponsors".' },
    },
    {
      name: 'table',
      type: 'relationship',
      relationTo: 'event-tables',
      index: true,
      admin: { description: 'Where the guest\'s party sits. Add tables under Events → Tables.' },
      filterOptions: ({ data }) => (data?.event ? { event: { equals: idOf(data.event) } } : false),
    },
    {
      name: 'partySize',
      type: 'number',
      required: true,
      defaultValue: 1,
      admin: { description: 'Seats on this invitation, the guest included. 2 lets them bring one person.' },
      validate: (value: unknown) =>
        isWholeNumber(value, 1, MAX_PARTY_SIZE) || `Enter a whole number from 1 to ${MAX_PARTY_SIZE}.`,
    },
    {
      name: 'language',
      type: 'select',
      required: true,
      defaultValue: DEFAULT_LOCALE,
      options: LOCALES.map((value) => ({ label: LOCALE_LABELS[value], value })),
      admin: { description: 'The language the invitation link opens in.' },
    },
    {
      name: 'invitationSentAt',
      label: 'Invitation emailed',
      type: 'date',
      admin: { readOnly: true, position: 'sidebar', date: { pickerAppearance: 'dayAndTime' }, description: 'When the invitation was emailed. Guests already emailed are skipped when invitations are sent.' },
      // Set only by the email job.
      access: { create: () => false, update: () => false },
    },
    {
      name: 'replyReminderSentAt',
      label: 'Reply reminder emailed',
      type: 'date',
      admin: { readOnly: true, position: 'sidebar', date: { pickerAppearance: 'dayAndTime' }, description: 'When the guest was last reminded to reply.' },
      // Set only by the email job.
      access: { create: () => false, update: () => false },
    },
    {
      name: 'dayBeforeSentAt',
      label: 'Reminder emailed',
      type: 'date',
      admin: { readOnly: true, position: 'sidebar', date: { pickerAppearance: 'dayAndTime' }, description: 'When the day-before reminder was emailed.' },
      // Set only by the email job.
      access: { create: () => false, update: () => false },
    },
    {
      name: 'invitationLink',
      type: 'ui',
      admin: { components: { Field: '@/components/admin/InvitationLinkField#InvitationLinkField' } },
    },
    {
      type: 'collapsible',
      label: 'Reply',
      fields: [
        {
          name: 'rsvpStatus',
          label: 'RSVP',
          type: 'select',
          required: true,
          defaultValue: 'pending',
          index: true,
          options: [
            { label: 'Not answered', value: 'pending' },
            { label: 'Attending', value: 'attending' },
            { label: 'Not attending', value: 'declined' },
          ] satisfies { value: (typeof RSVP_STATUSES)[number]; label: string }[],
          admin: { description: 'Guests answer from their link. Staff can also record an answer given by phone.' },
        },
        {
          name: 'attendingCount',
          type: 'number',
          defaultValue: 0,
          admin: { description: 'How many of the party are coming.' },
          validate: (value: unknown) =>
            value === null || value === undefined || isWholeNumber(value, 0, MAX_PARTY_SIZE) || 'Enter a whole number.',
        },
        {
          name: 'party',
          label: 'Who is coming',
          type: 'array',
          maxRows: MAX_PARTY_SIZE,
          labels: { singular: 'Person', plural: 'People' },
          admin: {
            description:
              'Filled in by the guest when they reply: the guest first, then whoever they bring, each with their meal when the event offers meal choices.',
          },
          fields: [
            {
              type: 'row',
              fields: [
                { name: 'name', type: 'text', maxLength: RSVP_LIMITS.personName, admin: { width: '50%' } },
                {
                  name: 'meal',
                  type: 'text',
                  maxLength: 64,
                  admin: {
                    width: '50%',
                    components: { Field: '@/components/admin/MealChoiceField#MealChoiceField' },
                  },
                },
              ],
            },
          ],
        },
        { name: 'dietaryNotes', type: 'textarea', maxLength: RSVP_LIMITS.dietaryNotes },
        {
          name: 'guestMessage',
          label: 'Message from the guest',
          type: 'textarea',
          maxLength: RSVP_LIMITS.guestMessage,
        },
        { name: 'respondedAt', type: 'date', admin: { readOnly: true, date: { pickerAppearance: 'dayAndTime' } } },
      ],
    },
    {
      type: 'collapsible',
      label: 'Check-in',
      fields: [
        {
          name: 'checkedInCount',
          label: 'Checked in',
          type: 'number',
          defaultValue: 0,
          admin: {
            description:
              'How many of the party have arrived. Staff set it at the door by scanning the guest\'s invitation code.',
          },
          validate: (value: unknown) =>
            value === null || value === undefined || isWholeNumber(value, 0, MAX_PARTY_SIZE) || 'Enter a whole number.',
        },
        {
          name: 'checkedInAt',
          type: 'date',
          admin: { readOnly: true, date: { pickerAppearance: 'dayAndTime' } },
        },
      ],
    },
    {
      name: 'staffNotes',
      type: 'textarea',
      maxLength: 2000,
      admin: { description: 'Only staff see this.' },
      access: { read: staffField, create: staffField, update: staffField },
    },
    {
      name: 'inviteToken',
      type: 'text',
      unique: true,
      admin: { hidden: true },
      // Only staff of the guest's own studio, and the event's organizers, may read it.
      access: {
        read: async ({ req, doc }) => {
          if (isGuestListStaff(req.user, idOf(doc?.tenant))) return true
          const organized = await organizedEventIds(req.payload, req.user, req)
          return organized.some((id) => String(id) === String(idOf(doc?.event)))
        },
      },
    },
  ],
}
