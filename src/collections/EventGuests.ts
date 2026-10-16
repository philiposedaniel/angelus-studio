import { APIError, Forbidden, type CollectionConfig } from 'payload'

import { hasTenantRole, isSuperAdmin, tenantRoles } from '@/access'
import { DEFAULT_LOCALE, LOCALE_LABELS, LOCALES } from '@/i18n/config'
import { exportGuestList, importGuestList } from '@/lib/guestListEndpoints'
import { idOf } from '@/lib/ids'
import { MAX_PARTY_SIZE, RSVP_LIMITS, RSVP_STATUSES } from '@/lib/rsvp'
import { newShareToken } from '@/lib/shareTokens'

/** Staff who manage guest lists. Guest names, contacts and dietary needs are personal data. */
export const EVENT_GUEST_STAFF_ROLES = ['admin', 'production-manager'] as const

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
    read: tenantRoles(EVENT_GUEST_STAFF_ROLES),
    create: tenantRoles(EVENT_GUEST_STAFF_ROLES),
    update: tenantRoles(EVENT_GUEST_STAFF_ROLES),
    delete: tenantRoles(EVENT_GUEST_STAFF_ROLES),
  },
  endpoints: [
    { path: '/export', method: 'get', handler: exportGuestList },
    { path: '/import', method: 'post', handler: importGuestList },
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
      ({ data, originalDoc, operation, req }) => {
        // Staff may only put guests on their own studio's events.
        const { user } = req
        if (user && !isSuperAdmin(user) && !hasTenantRole(user, idOf(data.tenant) ?? '', EVENT_GUEST_STAFF_ROLES)) {
          throw new Forbidden(req.t)
        }

        const partySize: number = data.partySize ?? originalDoc?.partySize ?? 1
        const status = data.rsvpStatus ?? originalDoc?.rsvpStatus ?? 'pending'
        let attendingCount: number = data.attendingCount ?? originalDoc?.attendingCount ?? 0
        if (status !== 'attending') attendingCount = 0
        else if (attendingCount < 1) attendingCount = 1
        if (attendingCount > partySize) {
          throw new APIError('More people are attending than this invitation has seats for.', 400)
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
    },
    {
      name: 'inviteToken',
      type: 'text',
      unique: true,
      admin: { hidden: true },
      // Only staff of the guest's own studio may read it.
      access: {
        read: ({ req: { user }, doc }) => {
          const tenantId = idOf(doc?.tenant)
          return (
            isSuperAdmin(user) || (tenantId !== undefined && hasTenantRole(user, tenantId, EVENT_GUEST_STAFF_ROLES))
          )
        },
      },
    },
  ],
}
