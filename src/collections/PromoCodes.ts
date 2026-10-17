import { APIError, Forbidden, type CollectionConfig } from 'payload'

import { hasTenantRole, isSuperAdmin, tenantRoles } from '@/access'
import { EVENT_GUEST_STAFF_ROLES } from '@/collections/EventGuests'
import { idOf } from '@/lib/ids'
import { MAX_AMOUNT } from '@/lib/money'
import { normalizePromoCode, PROMO_DISCOUNT_TYPES } from '@/lib/promoCodes'
import { isWholeNumber, MAX_TICKET_CAPACITY } from '@/lib/tickets'

/**
 * A code that takes money off an event's paid tickets on the event page: a percentage, or a fixed
 * amount off each place, optionally only for some tickets, between two dates, or for a number of
 * places. The price is worked out on the server when the registration is saved, never from the
 * form, and the code's limit is counted under a lock.
 */
export const PromoCodes: CollectionConfig = {
  slug: 'promo-codes',
  labels: { singular: 'Promo code', plural: 'Promo codes' },
  admin: {
    useAsTitle: 'code',
    defaultColumns: ['code', 'event', 'discountType', 'percentOff', 'amountOff', 'maxUses', 'active'],
    group: 'Events',
  },
  access: {
    read: tenantRoles(EVENT_GUEST_STAFF_ROLES),
    create: tenantRoles(EVENT_GUEST_STAFF_ROLES),
    update: tenantRoles(EVENT_GUEST_STAFF_ROLES),
    delete: tenantRoles(EVENT_GUEST_STAFF_ROLES),
  },
  hooks: {
    beforeValidate: [
      // A code belongs to its event's studio, stays on its event, and is stored in capitals.
      async ({ data, originalDoc, req }) => {
        if (!data) return data
        const eventId = idOf(data.event ?? originalDoc?.event)
        if (eventId === undefined || eventId === null) return data
        if (originalDoc?.event && String(idOf(originalDoc.event)) !== String(eventId)) {
          throw new APIError('A promo code cannot move to another event.', 400)
        }
        const event = await req.payload
          .findByID({ collection: 'events', id: eventId, depth: 0, req, overrideAccess: true })
          .catch(() => null)
        if (!event) throw new APIError('This event does not exist.', 400)
        data.tenant = idOf(event.tenant)
        if (typeof data.code === 'string') data.code = data.code.trim().toUpperCase()
        return data
      },
    ],
    beforeChange: [
      async ({ data, originalDoc, req }) => {
        const { user } = req
        if (user && !isSuperAdmin(user) && !hasTenantRole(user, idOf(data.tenant) ?? '', EVENT_GUEST_STAFF_ROLES)) {
          throw new Forbidden(req.t)
        }
        const eventId = idOf(data.event ?? originalDoc?.event)
        const code = data.code ?? originalDoc?.code
        const { totalDocs } = await req.payload.count({
          collection: 'promo-codes',
          where: {
            and: [
              { event: { equals: eventId } },
              { code: { equals: code } },
              ...(originalDoc?.id ? [{ id: { not_equals: originalDoc.id } }] : []),
            ],
          },
          req,
          overrideAccess: true,
        })
        if (totalDocs > 0) throw new APIError('This event already has that code.', 400)

        // Limits apply only to the event's own tickets.
        const ticketTypes = (data.ticketTypes ?? originalDoc?.ticketTypes ?? []).map((t: unknown) => idOf(t))
        if (ticketTypes.length > 0) {
          const { totalDocs: own } = await req.payload.count({
            collection: 'ticket-types',
            where: { and: [{ id: { in: ticketTypes } }, { event: { equals: eventId } }] },
            req,
            overrideAccess: true,
          })
          if (own !== ticketTypes.length) throw new APIError('Choose tickets of this event only.', 400)
        }
        const startsAt = data.startsAt ?? originalDoc?.startsAt
        const endsAt = data.endsAt ?? originalDoc?.endsAt
        if (startsAt && endsAt && new Date(endsAt).getTime() <= new Date(startsAt).getTime()) {
          throw new APIError('The code must stop working after it starts.', 400)
        }
        return data
      },
    ],
    beforeDelete: [
      // Registrations keep the code they used: a code someone used cannot be deleted.
      async ({ id, req }) => {
        const { totalDocs } = await req.payload.count({
          collection: 'registrations',
          where: { promoCode: { equals: id } },
          req,
          overrideAccess: true,
        })
        if (totalDocs > 0) {
          throw new APIError('People have registered with this code. Untick "Active" to stop it working instead.', 400)
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
    },
    {
      name: 'code',
      type: 'text',
      required: true,
      index: true,
      admin: { description: 'What people type on the event page, such as EARLYBIRD. Letters, digits, - and _; any case works.' },
      validate: (value: unknown) =>
        normalizePromoCode(value) !== null || 'Use 3 to 40 letters, digits, dashes or underscores.',
    },
    {
      type: 'row',
      fields: [
        {
          name: 'discountType',
          label: 'Discount',
          type: 'select',
          required: true,
          defaultValue: 'percent',
          options: [
            { label: 'Percentage off', value: 'percent' },
            { label: 'Amount off each place', value: 'amount' },
          ] satisfies { value: (typeof PROMO_DISCOUNT_TYPES)[number]; label: string }[],
          admin: { width: '34%' },
        },
        {
          name: 'percentOff',
          label: 'Percent off',
          type: 'number',
          admin: { width: '33%', condition: (_, sibling) => sibling?.discountType !== 'amount', description: '100 makes the ticket free.' },
          validate: (value: unknown, { siblingData }: { siblingData: Record<string, unknown> }) =>
            siblingData?.discountType === 'amount' || isWholeNumber(value, 1, 100) || 'Enter a whole number from 1 to 100.',
        },
        {
          name: 'amountOff',
          label: 'Amount off each place',
          type: 'number',
          admin: {
            width: '33%',
            condition: (_, sibling) => sibling?.discountType === 'amount',
            description: "In cents of the ticket's currency: 500 is 5.00.",
          },
          validate: (value: unknown, { siblingData }: { siblingData: Record<string, unknown> }) =>
            siblingData?.discountType !== 'amount' || isWholeNumber(value, 1, MAX_AMOUNT) || 'Enter the amount in cents.',
        },
      ],
    },
    {
      name: 'ticketTypes',
      label: 'Only for these tickets',
      type: 'relationship',
      relationTo: 'ticket-types',
      hasMany: true,
      admin: { description: "Leave empty for all of the event's paid tickets." },
      filterOptions: ({ siblingData }) => {
        const eventId = idOf((siblingData as Record<string, unknown> | undefined)?.event)
        return eventId === undefined || eventId === null ? false : { event: { equals: eventId } }
      },
    },
    {
      name: 'maxUses',
      label: 'Places at this price',
      type: 'number',
      admin: { description: 'How many places can be bought with the code in all. Empty for no limit.' },
      validate: (value: unknown) =>
        value === null || value === undefined || isWholeNumber(value, 1, MAX_TICKET_CAPACITY) || 'Enter a whole number, or leave empty.',
    },
    {
      type: 'row',
      fields: [
        { name: 'startsAt', label: 'Works from', type: 'date', admin: { width: '50%', date: { pickerAppearance: 'dayAndTime' } } },
        { name: 'endsAt', label: 'Works until', type: 'date', admin: { width: '50%', date: { pickerAppearance: 'dayAndTime' } } },
      ],
    },
    { name: 'active', type: 'checkbox', defaultValue: true, admin: { description: 'Untick to stop the code working.' } },
  ],
}
