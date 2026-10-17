import { APIError, Forbidden, type CollectionConfig, type FieldAccess } from 'payload'

import { hasTenantRole, isSuperAdmin, tenantRoles } from '@/access'
import { EVENT_GUEST_STAFF_ROLES } from '@/collections/EventGuests'
import { DEFAULT_LOCALE, LOCALE_LABELS, LOCALES } from '@/i18n/config'
import { idOf } from '@/lib/ids'
import { newShareToken } from '@/lib/shareTokens'
import { isWholeNumber, MAX_PER_ORDER_LIMIT } from '@/lib/tickets'
import { isWaitlistRefresh, isWaitlistSystem, refreshWaitlist, WAITLIST_STATUSES } from '@/lib/waitlist'

const staffOfDoc: FieldAccess = ({ req: { user }, doc }) => {
  const tenantId = idOf(doc?.tenant)
  return isSuperAdmin(user) || (tenantId !== undefined && hasTenantRole(user, tenantId, EVENT_GUEST_STAFF_ROLES))
}

/**
 * Someone waiting for places on a sold-out ticket. When places free up they are offered to the
 * people waiting, in the order they joined, and held for them for a day; each person claims
 * theirs with their private waitlist link (src/lib/waitlist.ts). People join from the event page,
 * so visitors never use this API.
 */
export const WaitlistEntries: CollectionConfig = {
  slug: 'waitlist-entries',
  labels: { singular: 'Waitlist entry', plural: 'Waitlist' },
  admin: {
    useAsTitle: 'name',
    defaultColumns: ['name', 'event', 'ticketType', 'quantity', 'status', 'offerExpiresAt', 'createdAt'],
    group: 'Events',
    listSearchableFields: ['name', 'email'],
  },
  defaultSort: 'createdAt',
  access: {
    read: tenantRoles(EVENT_GUEST_STAFF_ROLES),
    // People join through the event page; staff only follow the queue and take people off it.
    create: () => false,
    update: tenantRoles(EVENT_GUEST_STAFF_ROLES),
    delete: tenantRoles(EVENT_GUEST_STAFF_ROLES),
  },
  hooks: {
    beforeValidate: [
      async ({ data, originalDoc, req }) => {
        const ticketTypeId = idOf(data?.ticketType ?? originalDoc?.ticketType)
        if (!data || ticketTypeId === undefined || ticketTypeId === null) return data
        if (originalDoc?.ticketType && String(idOf(originalDoc.ticketType)) !== String(ticketTypeId)) {
          throw new APIError('A waitlist entry cannot move to another ticket.', 400)
        }
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
      ({ context, data, originalDoc, operation, req }) => {
        const { user } = req
        if (user && !isSuperAdmin(user) && !hasTenantRole(user, idOf(data.tenant) ?? '', EVENT_GUEST_STAFF_ROLES)) {
          throw new Forbidden(req.t)
        }
        // Staff can only take people off the queue; offers and claims are made by the waitlist itself.
        const statusChange = data.status !== undefined && data.status !== originalDoc?.status
        if (user && statusChange && data.status !== 'removed' && !isWaitlistSystem(context)) {
          throw new APIError('Staff can only remove people from the waitlist.', 400)
        }
        return {
          ...data,
          // Set on create, kept on change, never taken from the request.
          claimToken: operation === 'create' || !originalDoc?.claimToken ? newShareToken() : originalDoc.claimToken,
        }
      },
    ],
    afterChange: [
      // Someone leaving the queue, or an offer ending, may free places for the next person.
      async ({ context, doc, previousDoc, operation, req }) => {
        if (operation === 'update' && previousDoc?.status !== doc.status && !isWaitlistRefresh(context)) {
          await refreshWaitlist(req.payload, idOf(doc.ticketType)!, { req })
        }
        return doc
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
      admin: { readOnly: true },
    },
    { name: 'event', type: 'relationship', relationTo: 'events', index: true, admin: { readOnly: true } },
    { name: 'name', type: 'text', required: true, maxLength: 120, admin: { readOnly: true } },
    { name: 'email', type: 'email', required: true, index: true, admin: { readOnly: true } },
    { name: 'phone', type: 'text', maxLength: 40, admin: { readOnly: true } },
    {
      name: 'quantity',
      label: 'Places',
      type: 'number',
      required: true,
      defaultValue: 1,
      admin: { readOnly: true },
      validate: (value: unknown) =>
        isWholeNumber(value, 1, MAX_PER_ORDER_LIMIT) || `Enter a whole number from 1 to ${MAX_PER_ORDER_LIMIT}.`,
    },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'waiting',
      index: true,
      options: [
        { label: 'Waiting', value: 'waiting' },
        { label: 'Offered a place', value: 'offered' },
        { label: 'Claimed', value: 'claimed' },
        { label: 'Offer expired', value: 'expired' },
        { label: 'Left the waitlist', value: 'left' },
        { label: 'Removed by staff', value: 'removed' },
      ] satisfies { value: (typeof WAITLIST_STATUSES)[number]; label: string }[],
      admin: { description: 'Choose "Removed by staff" to take someone off the waitlist. The rest changes by itself.' },
    },
    {
      name: 'offerExpiresAt',
      label: 'Offer held until',
      type: 'date',
      admin: { readOnly: true, date: { pickerAppearance: 'dayAndTime' } },
    },
    { name: 'registration', type: 'relationship', relationTo: 'registrations', admin: { readOnly: true } },
    {
      name: 'language',
      type: 'select',
      required: true,
      defaultValue: DEFAULT_LOCALE,
      options: LOCALES.map((value) => ({ label: LOCALE_LABELS[value], value })),
      admin: { readOnly: true },
    },
    {
      name: 'waitlistLink',
      type: 'ui',
      admin: { components: { Field: '@/components/admin/WaitlistLinkField#WaitlistLinkField' } },
    },
    { name: 'claimToken', type: 'text', unique: true, admin: { hidden: true }, access: { read: staffOfDoc } },
    {
      name: 'senderKey',
      type: 'text',
      index: true,
      admin: { hidden: true },
      access: { read: () => false, update: () => false },
    },
  ],
}
