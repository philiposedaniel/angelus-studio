import { APIError, Forbidden, type CollectionConfig } from 'payload'

import { hasTenantRole, isSuperAdmin, tenantRoles } from '@/access'
import { EVENT_GUEST_STAFF_ROLES } from '@/collections/EventGuests'
import { idOf } from '@/lib/ids'
import { MAX_TABLE_CAPACITY } from '@/lib/seating'

/**
 * A table at an event. Guests are seated by choosing a table on the guest; the event shows each
 * table with who sits there and how many seats are taken (src/lib/seating.ts). Same staff as the
 * guest list, because the seating plan shows guests' names.
 */
export const EventTables: CollectionConfig = {
  slug: 'event-tables',
  labels: { singular: 'Table', plural: 'Tables' },
  admin: {
    useAsTitle: 'name',
    defaultColumns: ['name', 'event', 'capacity', 'sortOrder'],
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
      // A table belongs to its event's studio, and its name is not repeated within the event.
      async ({ data, originalDoc, req }) => {
        const eventId = idOf(data?.event ?? originalDoc?.event)
        if (!data || eventId === undefined) return data
        const event = await req.payload
          .findByID({ collection: 'events', id: eventId, depth: 0, req, overrideAccess: true })
          .catch(() => null)
        if (!event) throw new APIError('This event does not exist.', 400)
        data.tenant = idOf(event.tenant)

        const name = typeof (data.name ?? originalDoc?.name) === 'string' ? String(data.name ?? originalDoc?.name).trim() : ''
        if (name) {
          const { totalDocs } = await req.payload.count({
            collection: 'event-tables',
            where: {
              and: [
                { event: { equals: eventId } },
                { name: { equals: name } },
                ...(originalDoc?.id ? [{ id: { not_equals: originalDoc.id } }] : []),
              ],
            },
            req,
            overrideAccess: true,
          })
          if (totalDocs > 0) throw new APIError('This event already has a table with that name.', 400)
        }
        return data
      },
    ],
    beforeChange: [
      ({ data, req }) => {
        const { user } = req
        if (user && !isSuperAdmin(user) && !hasTenantRole(user, idOf(data.tenant) ?? '', EVENT_GUEST_STAFF_ROLES)) {
          throw new Forbidden(req.t)
        }
        return data
      },
    ],
    beforeDelete: [
      // Guests at a removed table are not removed; they go back to having no table.
      async ({ id, req }) => {
        await req.payload.update({
          collection: 'event-guests',
          where: { table: { equals: id } },
          data: { table: null },
          req,
          overrideAccess: true,
        })
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
      maxLength: 60,
      admin: { description: 'As guests and staff will see it, e.g. "Table 4", "Head table" or "Jasmine".' },
    },
    {
      name: 'capacity',
      label: 'Seats',
      type: 'number',
      required: true,
      defaultValue: 10,
      validate: (value: unknown) =>
        (typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= MAX_TABLE_CAPACITY) ||
        `Enter a whole number from 1 to ${MAX_TABLE_CAPACITY}.`,
    },
    {
      name: 'sortOrder',
      label: 'Order',
      type: 'number',
      defaultValue: 0,
      admin: { description: 'Lower numbers are listed first.' },
    },
    { name: 'notes', type: 'textarea', maxLength: 1000, admin: { description: 'Only staff see this.' } },
  ],
}
