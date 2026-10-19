import { APIError, type CollectionConfig } from 'payload'

import { tenantRoles } from '@/access'
import { staffOnlyField, staffOrOrganizersVendors } from '@/lib/organizers'
import { VENDOR_CATEGORIES, VENDOR_CATEGORY_LABELS, VENDOR_STAFF_ROLES } from '@/lib/vendors'

/** Organizers see a booked vendor's name and category; contact details and notes stay with staff. */
const staffField = staffOnlyField(VENDOR_STAFF_ROLES)

/** The studio's vendor directory: the venues, caterers, musicians and others it works with. */
export const Vendors: CollectionConfig = {
  slug: 'vendors',
  labels: { singular: 'Vendor', plural: 'Vendors' },
  admin: {
    useAsTitle: 'name',
    defaultColumns: ['name', 'category', 'contactName', 'email', 'phone'],
    group: 'Events',
    listSearchableFields: ['name', 'contactName', 'email'],
  },
  defaultSort: 'name',
  access: {
    read: staffOrOrganizersVendors(VENDOR_STAFF_ROLES),
    create: tenantRoles(VENDOR_STAFF_ROLES),
    update: tenantRoles(VENDOR_STAFF_ROLES),
    delete: tenantRoles(['admin']),
  },
  hooks: {
    beforeDelete: [
      // Bookings carry what was agreed and paid, so they are never removed along with a vendor.
      async ({ id, req }) => {
        const { totalDocs } = await req.payload.count({
          collection: 'event-vendors',
          where: { vendor: { equals: id } },
          req,
          overrideAccess: true,
        })
        if (totalDocs > 0) {
          throw new APIError('This vendor is booked for events. Remove those bookings first.', 400)
        }
      },
    ],
  },
  fields: [
    { name: 'name', type: 'text', required: true, maxLength: 160 },
    {
      name: 'category',
      type: 'select',
      required: true,
      index: true,
      options: VENDOR_CATEGORIES.map((value) => ({ value, label: VENDOR_CATEGORY_LABELS[value] })),
    },
    { name: 'contactName', type: 'text', maxLength: 120, access: { read: staffField } },
    { name: 'email', type: 'email', access: { read: staffField } },
    { name: 'phone', type: 'text', maxLength: 40, access: { read: staffField } },
    {
      name: 'website',
      type: 'text',
      access: { read: staffField },
      maxLength: 300,
      validate: (value: string | null | undefined) =>
        !value || /^https?:\/\/[^\s]+$/.test(value) || 'Use a full address starting with https://',
    },
    { name: 'address', type: 'textarea', maxLength: 500, access: { read: staffField } },
    {
      name: 'notes',
      type: 'textarea',
      maxLength: 4000,
      access: { read: staffField },
      admin: { description: 'Rates, terms, what worked well. Only staff see this.' },
    },
  ],
}
