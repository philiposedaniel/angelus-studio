import { APIError, Forbidden, type CollectionConfig, type FieldAccess } from 'payload'

import { hasTenantRole, isSuperAdmin, tenantRoles } from '@/access'
import { EVENT_GUEST_STAFF_ROLES } from '@/collections/EventGuests'
import { DEFAULT_LOCALE, LOCALE_LABELS, LOCALES } from '@/i18n/config'
import { idOf } from '@/lib/ids'
import { newShareToken } from '@/lib/shareTokens'
import {
  isWholeNumber,
  lockTicketType,
  MAX_REGISTRATION_QUANTITY,
  placesTaken,
  REGISTRATION_STATUSES,
  SOLD_OUT_STATUS,
} from '@/lib/tickets'

/** Fields only the studio's own guest-list staff may read. */
const staffOfDoc: FieldAccess = ({ req: { user }, doc }) => {
  const tenantId = idOf(doc?.tenant)
  return isSuperAdmin(user) || (tenantId !== undefined && hasTenantRole(user, tenantId, EVENT_GUEST_STAFF_ROLES))
}

/**
 * A booking of one or more places on a ticket type. People register on the event page; the
 * page's server action saves the registration after its own checks, so visitors never use this
 * API. Each registration has a private ticket link with an entry code staff scan at the door.
 * Staff can also add registrations by hand, for example for people who book by phone.
 */
export const Registrations: CollectionConfig = {
  slug: 'registrations',
  labels: { singular: 'Registration', plural: 'Registrations' },
  admin: {
    useAsTitle: 'name',
    defaultColumns: ['name', 'event', 'ticketType', 'quantity', 'status', 'checkedInCount', 'createdAt'],
    group: 'Events',
    listSearchableFields: ['name', 'email'],
  },
  defaultSort: '-createdAt',
  access: {
    read: tenantRoles(EVENT_GUEST_STAFF_ROLES),
    create: tenantRoles(EVENT_GUEST_STAFF_ROLES),
    update: tenantRoles(EVENT_GUEST_STAFF_ROLES),
    delete: tenantRoles(EVENT_GUEST_STAFF_ROLES),
  },
  hooks: {
    beforeValidate: [
      // The event and studio always come from the ticket type.
      async ({ data, originalDoc, req }) => {
        const ticketTypeId = idOf(data?.ticketType ?? originalDoc?.ticketType)
        if (!data || ticketTypeId === undefined || ticketTypeId === null) return data
        const ticketType = await req.payload
          .findByID({ collection: 'ticket-types', id: ticketTypeId, depth: 0, req, overrideAccess: true })
          .catch(() => null)
        if (!ticketType) throw new APIError('This ticket type does not exist.', 400)
        data.event = idOf(ticketType.event)
        data.tenant = idOf(ticketType.tenant)
        return data
      },
    ],
    beforeChange: [
      async ({ data, originalDoc, operation, req }) => {
        const { user } = req
        if (user && !isSuperAdmin(user) && !hasTenantRole(user, idOf(data.tenant) ?? '', EVENT_GUEST_STAFF_ROLES)) {
          throw new Forbidden(req.t)
        }

        const ticketTypeId = idOf(data.ticketType ?? originalDoc?.ticketType)
        const quantity: number = data.quantity ?? originalDoc?.quantity ?? 1
        const status = data.status ?? originalDoc?.status ?? 'confirmed'
        // Counted under a lock, so two registrations for the last places cannot both succeed.
        const takesMorePlaces =
          status === 'confirmed' &&
          (operation === 'create' ||
            originalDoc?.status !== 'confirmed' ||
            quantity > (originalDoc?.quantity ?? 0) ||
            String(idOf(originalDoc?.ticketType)) !== String(ticketTypeId))
        if (takesMorePlaces && ticketTypeId !== undefined && ticketTypeId !== null) {
          await lockTicketType(req, ticketTypeId)
          const ticketType = await req.payload.findByID({
            collection: 'ticket-types',
            id: ticketTypeId,
            depth: 0,
            req,
            overrideAccess: true,
          })
          const taken = await placesTaken(req.payload, ticketTypeId, { req, excludeId: originalDoc?.id })
          if (taken + quantity > (ticketType.capacity ?? 0)) {
            throw new APIError(
              `Not enough places left on this ticket: ${Math.max(0, (ticketType.capacity ?? 0) - taken)} left.`,
              SOLD_OUT_STATUS,
            )
          }
        }

        const checkedInCount: number = data.checkedInCount ?? originalDoc?.checkedInCount ?? 0
        if (checkedInCount > quantity) {
          throw new APIError('More people are checked in than this registration has places for.', 400)
        }
        // The arrival time is kept from the first check-in and cleared when it is undone.
        const checkedInAt =
          checkedInCount === 0 ? null : (data.checkedInAt ?? originalDoc?.checkedInAt ?? new Date().toISOString())

        return {
          ...data,
          checkedInCount,
          checkedInAt,
          // Set on create, kept on change, never taken from the request.
          ticketToken:
            operation === 'create' || !originalDoc?.ticketToken ? newShareToken() : originalDoc.ticketToken,
        }
      },
    ],
  },
  fields: [
    {
      name: 'ticketType',
      type: 'relationship',
      relationTo: 'ticket-types',
      required: true,
      index: true,
      filterOptions: ({ data }) => (data?.tenant ? { tenant: { equals: data.tenant } } : true),
    },
    {
      name: 'event',
      type: 'relationship',
      relationTo: 'events',
      index: true,
      admin: { readOnly: true, description: 'Set from the ticket type.' },
    },
    { name: 'name', type: 'text', required: true, maxLength: 120 },
    { name: 'email', type: 'email', required: true, index: true },
    { name: 'phone', type: 'text', maxLength: 40 },
    {
      name: 'quantity',
      label: 'Places',
      type: 'number',
      required: true,
      defaultValue: 1,
      validate: (value: unknown) =>
        isWholeNumber(value, 1, MAX_REGISTRATION_QUANTITY) ||
        `Enter a whole number from 1 to ${MAX_REGISTRATION_QUANTITY}.`,
    },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'confirmed',
      index: true,
      options: [
        { label: 'Confirmed', value: 'confirmed' },
        { label: 'Cancelled', value: 'cancelled' },
      ] satisfies { value: (typeof REGISTRATION_STATUSES)[number]; label: string }[],
      admin: { description: 'Cancelling frees the places and stops the ticket from working at the door.' },
    },
    {
      name: 'language',
      type: 'select',
      required: true,
      defaultValue: DEFAULT_LOCALE,
      options: LOCALES.map((value) => ({ label: LOCALE_LABELS[value], value })),
      admin: { description: 'The language the ticket link opens in.' },
    },
    {
      name: 'ticketLink',
      type: 'ui',
      admin: { components: { Field: '@/components/admin/TicketLinkField#TicketLinkField' } },
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
          admin: { description: 'How many have arrived. Staff set it at the door by scanning the ticket.' },
          validate: (value: unknown) =>
            value === null ||
            value === undefined ||
            isWholeNumber(value, 0, MAX_REGISTRATION_QUANTITY) ||
            'Enter a whole number.',
        },
        { name: 'checkedInAt', type: 'date', admin: { readOnly: true, date: { pickerAppearance: 'dayAndTime' } } },
      ],
    },
    { name: 'staffNotes', type: 'textarea', maxLength: 2000, admin: { description: 'Only staff see this.' } },
    {
      name: 'ticketToken',
      type: 'text',
      unique: true,
      admin: { hidden: true },
      access: { read: staffOfDoc },
    },
    {
      // A keyed hash of the address the registration came from, to limit repeats. Never shown.
      name: 'senderKey',
      type: 'text',
      index: true,
      admin: { hidden: true },
      access: { read: () => false, update: () => false },
    },
  ],
}
