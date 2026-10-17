import { APIError, Forbidden, type CollectionConfig } from 'payload'

import { hasTenantRole, isSuperAdmin, tenantRoles } from '@/access'
import { EVENT_GUEST_STAFF_ROLES } from '@/collections/EventGuests'
import { idOf } from '@/lib/ids'
import { CURRENCIES, CURRENCY_LABELS, MAX_AMOUNT } from '@/lib/money'
import {
  DEFAULT_MAX_PER_ORDER,
  isWholeNumber,
  lockTicketType,
  MAX_PER_ORDER_LIMIT,
  MAX_TICKET_CAPACITY,
  placesTaken,
} from '@/lib/tickets'

/**
 * A kind of ticket for an event, such as "General admission", with its price, how many places it
 * has and when it can be booked. Paid tickets are sold through Stripe Checkout and confirmed by
 * the verified webhook. The website reads ticket types on the server for published events, so
 * only staff use this API.
 */
export const TicketTypes: CollectionConfig = {
  slug: 'ticket-types',
  labels: { singular: 'Ticket type', plural: 'Ticket types' },
  admin: {
    useAsTitle: 'name',
    defaultColumns: ['name', 'event', 'capacity', 'onSale', 'sortOrder'],
    group: 'Events',
  },
  defaultSort: 'sortOrder',
  access: {
    read: tenantRoles(EVENT_GUEST_STAFF_ROLES),
    create: tenantRoles(EVENT_GUEST_STAFF_ROLES),
    update: tenantRoles(EVENT_GUEST_STAFF_ROLES),
    delete: tenantRoles(EVENT_GUEST_STAFF_ROLES),
  },
  hooks: {
    beforeValidate: [
      // A ticket type belongs to its event's studio and cannot move to another event.
      async ({ data, originalDoc, req }) => {
        const eventId = idOf(data?.event ?? originalDoc?.event)
        if (!data || eventId === undefined) return data
        if (originalDoc?.event && String(idOf(originalDoc.event)) !== String(eventId)) {
          throw new APIError('A ticket type cannot move to another event.', 400)
        }
        const event = await req.payload
          .findByID({ collection: 'events', id: eventId, depth: 0, req, overrideAccess: true })
          .catch(() => null)
        if (!event) throw new APIError('This event does not exist.', 400)
        data.tenant = idOf(event.tenant)
        return data
      },
    ],
    beforeChange: [
      async ({ data, originalDoc, req }) => {
        const { user } = req
        if (user && !isSuperAdmin(user) && !hasTenantRole(user, idOf(data.tenant) ?? '', EVENT_GUEST_STAFF_ROLES)) {
          throw new Forbidden(req.t)
        }
        const salesStart = data.salesStart ?? originalDoc?.salesStart
        const salesEnd = data.salesEnd ?? originalDoc?.salesEnd
        if (salesStart && salesEnd && new Date(salesEnd) < new Date(salesStart)) {
          throw new APIError('Sales must end after they start.', 400)
        }
        // People already registered keep the price they saw: it cannot change under them.
        const priceChanged =
          (data.price !== undefined && data.price !== originalDoc?.price) ||
          (data.currency !== undefined && data.currency !== originalDoc?.currency)
        if (originalDoc?.id && priceChanged) {
          const { totalDocs } = await req.payload.count({
            collection: 'registrations',
            where: { ticketType: { equals: originalDoc.id } },
            req,
            overrideAccess: true,
          })
          if (totalDocs > 0) {
            throw new APIError('People have registered for this ticket, so its price cannot change. Add a new ticket type instead.', 400)
          }
        }
        // Places already taken cannot be taken away by lowering the capacity.
        if (originalDoc?.id && typeof data.capacity === 'number' && data.capacity < (originalDoc.capacity ?? 0)) {
          await lockTicketType(req, originalDoc.id)
          const taken = await placesTaken(req.payload, originalDoc.id, { req })
          if (data.capacity < taken) {
            throw new APIError(`${taken} places are already taken. Cancel registrations before lowering the capacity.`, 400)
          }
        }
        return data
      },
    ],
    beforeDelete: [
      // Registered people keep their tickets: a ticket type with registrations cannot be deleted.
      async ({ id, req }) => {
        const { totalDocs } = await req.payload.count({
          collection: 'registrations',
          where: { ticketType: { equals: id } },
          req,
          overrideAccess: true,
        })
        if (totalDocs > 0) {
          throw new APIError('People have registered for this ticket. Untick "On sale" instead, or delete the registrations first.', 400)
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
    {
      name: 'name',
      type: 'text',
      required: true,
      localized: true,
      maxLength: 120,
      admin: { description: 'As people see it on the event page, e.g. "General admission".' },
    },
    { name: 'description', type: 'textarea', localized: true, maxLength: 500 },
    {
      type: 'row',
      fields: [
        {
          name: 'price',
          type: 'number',
          required: true,
          defaultValue: 0,
          admin: {
            width: '50%',
            description:
              'Per place, in cents: 2500 is 25.00. 0 makes the ticket free. Paid tickets are only offered once online payments are set up.',
          },
          validate: (value: unknown) =>
            isWholeNumber(value, 0, MAX_AMOUNT) || 'Enter the price in cents, as a whole number.',
        },
        {
          name: 'currency',
          type: 'select',
          required: true,
          defaultValue: 'eur',
          admin: { width: '50%' },
          options: CURRENCIES.map((value) => ({ label: CURRENCY_LABELS[value], value })),
        },
      ],
    },
    {
      type: 'row',
      fields: [
        {
          name: 'capacity',
          label: 'Places',
          type: 'number',
          required: true,
          defaultValue: 100,
          admin: { width: '50%', description: 'How many people this ticket admits in total.' },
          validate: (value: unknown) =>
            isWholeNumber(value, 1, MAX_TICKET_CAPACITY) || `Enter a whole number from 1 to ${MAX_TICKET_CAPACITY}.`,
        },
        {
          name: 'maxPerOrder',
          label: 'Places per registration',
          type: 'number',
          required: true,
          defaultValue: DEFAULT_MAX_PER_ORDER,
          admin: { width: '50%', description: 'The most places one person can book at once on the website.' },
          validate: (value: unknown) =>
            isWholeNumber(value, 1, MAX_PER_ORDER_LIMIT) || `Enter a whole number from 1 to ${MAX_PER_ORDER_LIMIT}.`,
        },
      ],
    },
    {
      type: 'row',
      fields: [
        {
          name: 'salesStart',
          label: 'Registration opens',
          type: 'date',
          admin: {
            width: '50%',
            date: { pickerAppearance: 'dayAndTime' },
            description: 'Optional. Empty opens it at once.',
          },
        },
        {
          name: 'salesEnd',
          label: 'Registration closes',
          type: 'date',
          admin: {
            width: '50%',
            date: { pickerAppearance: 'dayAndTime' },
            description: 'Optional. Empty closes it when the event ends.',
          },
        },
      ],
    },
    {
      name: 'onSale',
      label: 'On sale',
      type: 'checkbox',
      defaultValue: true,
      admin: { description: 'Untick to stop new registrations. Existing tickets keep working.' },
    },
    {
      name: 'sortOrder',
      label: 'Order',
      type: 'number',
      defaultValue: 0,
      admin: { description: 'Lower numbers are listed first.' },
    },
  ],
}
