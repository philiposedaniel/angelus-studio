import { APIError, Forbidden, type CollectionConfig } from 'payload'

import { hasTenantRole, isSuperAdmin, tenantRoles } from '@/access'
import { queueEmail } from '@/lib/email'
import { idOf } from '@/lib/ids'
import { CURRENCIES, CURRENCY_LABELS, MAX_AMOUNT } from '@/lib/money'
import { newShareToken } from '@/lib/shareTokens'
import { ORGANIZER_VENDOR_STATUSES, staffOnlyField, staffOrEventOrganizers } from '@/lib/organizers'
import { BOOKING_STATUSES, BOOKING_STATUS_LABELS, sendVendorLink, VENDOR_STAFF_ROLES } from '@/lib/vendors'

/** Money, notes and links stay with the studio's staff; organizers see who is coming and when. */
const staffField = staffOnlyField(VENDOR_STAFF_ROLES)

const isAmount = (value: unknown) =>
  value === null ||
  value === undefined ||
  (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= MAX_AMOUNT) ||
  'Enter a whole number of minor units (cents): 12550 means 125.50.'

/**
 * A vendor booked for one event: their role, when they arrive, what they are owed and paid.
 * Each booking has a private link (`/<language>/vendor/<vendorToken>`) where the vendor sees
 * their details and confirms; the page's server action saves that (src/lib/vendors.ts).
 */
export const EventVendors: CollectionConfig = {
  slug: 'event-vendors',
  labels: { singular: 'Event vendor', plural: 'Event vendors' },
  admin: {
    useAsTitle: 'role',
    defaultColumns: ['vendor', 'event', 'role', 'status', 'arrivalAt', 'amountDue', 'amountPaid'],
    group: 'Events',
  },
  defaultSort: 'arrivalAt',
  access: {
    // The event's organizers see its booked and confirmed vendors, read only.
    read: staffOrEventOrganizers(VENDOR_STAFF_ROLES, { organizerWhere: { status: { in: [...ORGANIZER_VENDOR_STATUSES] } } }),
    create: tenantRoles(VENDOR_STAFF_ROLES),
    update: tenantRoles(VENDOR_STAFF_ROLES),
    delete: tenantRoles(VENDOR_STAFF_ROLES),
  },
  endpoints: [{ path: '/send-link', method: 'post', handler: sendVendorLink }],
  hooks: {
    afterChange: [
      async ({ doc, previousDoc, operation, req }) => {
        // A vendor newly booked gets their link by email.
        const wasBooked = operation === 'update' && ['booked', 'confirmed'].includes(previousDoc?.status)
        if (doc.status === 'booked' && !wasBooked) await queueEmail(req, 'vendorBooking', doc.id)
        // The studio hears when the vendor confirms from their link (staff confirming by hand sign in).
        if (!req.user && doc.status === 'confirmed' && doc.confirmedAt && doc.confirmedAt !== previousDoc?.confirmedAt) {
          await queueEmail(req, 'vendorConfirmed', doc.id)
        }
        return doc
      },
    ],
    beforeValidate: [
      // A booking belongs to its event's studio, and its vendor must be from that studio too.
      async ({ data, originalDoc, req }) => {
        if (!data) return data
        const eventId = idOf(data.event ?? originalDoc?.event)
        const vendorId = idOf(data.vendor ?? originalDoc?.vendor)
        if (eventId === undefined || vendorId === undefined) return data
        const [event, vendor] = await Promise.all([
          req.payload.findByID({ collection: 'events', id: eventId, depth: 0, req, overrideAccess: true }).catch(() => null),
          req.payload.findByID({ collection: 'vendors', id: vendorId, depth: 0, req, overrideAccess: true }).catch(() => null),
        ])
        if (!event) throw new APIError('This event does not exist.', 400)
        if (!vendor) throw new APIError('This vendor does not exist.', 400)
        if (String(idOf(vendor.tenant)) !== String(idOf(event.tenant))) {
          throw new APIError('The vendor must be one of this studio\'s vendors.', 400)
        }
        data.tenant = idOf(event.tenant)
        return data
      },
    ],
    beforeChange: [
      ({ data, originalDoc, operation, req }) => {
        const { user } = req
        if (user && !isSuperAdmin(user) && !hasTenantRole(user, idOf(data.tenant) ?? '', VENDOR_STAFF_ROLES)) {
          throw new Forbidden(req.t)
        }
        const status = data.status ?? originalDoc?.status
        // Confirmation time follows the status: set when it is confirmed, cleared when it is not.
        const confirmedAt =
          status === 'confirmed' ? (data.confirmedAt ?? originalDoc?.confirmedAt ?? new Date().toISOString()) : null
        return {
          ...data,
          confirmedAt,
          // Set on create, kept on change, never taken from the request.
          vendorToken:
            operation === 'create' || !originalDoc?.vendorToken ? newShareToken() : originalDoc.vendorToken,
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
      name: 'vendor',
      type: 'relationship',
      relationTo: 'vendors',
      required: true,
      index: true,
      filterOptions: ({ data }) => (data?.tenant ? { tenant: { equals: data.tenant } } : true),
    },
    {
      name: 'role',
      type: 'text',
      required: true,
      maxLength: 120,
      admin: { description: 'What they do at this event, e.g. "DJ for the reception".' },
    },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'booked',
      index: true,
      options: BOOKING_STATUSES.map((value) => ({ value, label: BOOKING_STATUS_LABELS[value] })),
      admin: { position: 'sidebar' },
    },
    {
      name: 'arrivalAt',
      label: 'Arrives at',
      type: 'date',
      admin: { date: { pickerAppearance: 'dayAndTime' }, description: 'When they should arrive to set up.' },
    },
    {
      name: 'instructions',
      type: 'textarea',
      maxLength: 4000,
      admin: { description: 'Shown to the vendor on their link: access, parking, power, the contact on site.' },
    },
    {
      type: 'row',
      fields: [
        {
          name: 'currency',
          access: { read: staffField },
          type: 'select',
          required: true,
          defaultValue: 'eur',
          options: CURRENCIES.map((value) => ({ label: CURRENCY_LABELS[value], value })),
        },
        {
          name: 'amountDue',
          access: { read: staffField },
          type: 'number',
          defaultValue: 0,
          admin: { description: 'Agreed fee, in minor units (12550 means 125.50).' },
          validate: isAmount,
        },
        {
          name: 'amountPaid',
          access: { read: staffField },
          type: 'number',
          defaultValue: 0,
          admin: { description: 'Paid so far, in minor units.' },
          validate: isAmount,
        },
      ],
    },
    { name: 'paymentDueDate', type: 'date', access: { read: staffField }, admin: { date: { pickerAppearance: 'dayOnly' } } },
    {
      name: 'vendorLink',
      type: 'ui',
      admin: { components: { Field: '@/components/admin/VendorLinkField#VendorLinkField' } },
    },
    {
      name: 'bookingEmailedAt',
      label: 'Link emailed',
      type: 'date',
      admin: { readOnly: true, position: 'sidebar', date: { pickerAppearance: 'dayAndTime' }, description: 'When the vendor was last emailed their link.' },
      // Set only by the email job.
      access: { read: staffField, create: () => false, update: () => false },
    },
    {
      name: 'confirmationNoticeSentFor',
      type: 'date',
      admin: { hidden: true },
      // The confirmation the studio was last emailed about, set only by the email job.
      access: { read: staffField, create: () => false, update: () => false },
    },
    {
      name: 'confirmedAt',
      type: 'date',
      admin: { readOnly: true, position: 'sidebar', date: { pickerAppearance: 'dayAndTime' } },
    },
    {
      name: 'vendorNote',
      label: 'Note from the vendor',
      type: 'textarea',
      maxLength: 1000,
      access: { read: staffField },
      admin: { readOnly: true },
    },
    { name: 'staffNotes', type: 'textarea', maxLength: 2000, access: { read: staffField }, admin: { description: 'Only staff see this.' } },
    {
      name: 'vendorToken',
      type: 'text',
      unique: true,
      admin: { hidden: true },
      access: { read: staffField },
    },
  ],
}
