import type { CollectionConfig } from 'payload'

import { tenantAdmins, tenantRoles } from '@/access'
import { EVENT_TYPES } from '@/lib/inquiryOptions'

/** Staff who answer enquiries and turn them into quotes. */
export const INQUIRY_STAFF_ROLES = ['admin', 'production-manager', 'finance-manager'] as const

export const INQUIRY_STATUSES = ['new', 'contacted', 'quoted', 'booked', 'closed'] as const

/**
 * Requests sent from the website's contact form. Visitors never use this API directly:
 * the form's server action validates, filters spam and creates the record (see
 * src/lib/inquiries.ts), so public create access stays off.
 */
export const Inquiries: CollectionConfig = {
  slug: 'inquiries',
  labels: { singular: 'Inquiry', plural: 'Inquiries' },
  admin: {
    useAsTitle: 'name',
    defaultColumns: ['name', 'eventType', 'eventDate', 'status', 'createdAt'],
    group: 'Sales',
  },
  defaultSort: '-createdAt',
  access: {
    read: tenantRoles(INQUIRY_STAFF_ROLES),
    create: () => false,
    update: tenantRoles(INQUIRY_STAFF_ROLES),
    delete: tenantAdmins,
  },
  fields: [
    { name: 'name', type: 'text', required: true, maxLength: 120 },
    { name: 'email', type: 'email', required: true, index: true },
    { name: 'phone', type: 'text', maxLength: 40 },
    {
      name: 'eventType',
      type: 'select',
      required: true,
      options: EVENT_TYPES.map((value) => ({
        label: value[0]!.toUpperCase() + value.slice(1),
        value,
      })),
    },
    { name: 'eventDate', type: 'date', admin: { date: { pickerAppearance: 'dayOnly' } } },
    { name: 'location', type: 'text', maxLength: 200 },
    { name: 'message', type: 'textarea', required: true, maxLength: 5000 },
    {
      name: 'locale',
      type: 'text',
      admin: { readOnly: true, description: 'Language the visitor wrote in; reply in it.' },
    },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'new',
      index: true,
      options: INQUIRY_STATUSES.map((value) => ({
        label: value[0]!.toUpperCase() + value.slice(1),
        value,
      })),
      admin: { position: 'sidebar' },
    },
    {
      name: 'notes',
      type: 'textarea',
      admin: { position: 'sidebar', description: 'Internal notes.' },
    },
    {
      // A keyed hash of the sender's address, kept only to limit repeated submissions.
      name: 'senderKey',
      type: 'text',
      index: true,
      admin: { hidden: true },
      access: { read: () => false },
    },
  ],
}
