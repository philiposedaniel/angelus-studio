import type { CollectionConfig } from 'payload'

import { tenantAdmins, tenantRoles } from '@/access'
import { CURRENCIES, CURRENCY_LABELS } from '@/lib/money'

/** Staff who see money received. */
export const PAYMENT_ROLES = ['admin', 'finance-manager'] as const

/**
 * Online payments made through Stripe Checkout. Created when a client starts paying and
 * confirmed only by a verified Stripe webhook (see src/lib/stripeWebhook.ts). Nobody
 * can create, change or delete these through the admin or the API.
 */
export const Payments: CollectionConfig = {
  slug: 'payments',
  labels: { singular: 'Payment', plural: 'Payments' },
  admin: {
    useAsTitle: 'stripeSessionId',
    defaultColumns: ['quote', 'amount', 'currency', 'status', 'paidAt'],
    group: 'Sales',
  },
  defaultSort: '-createdAt',
  access: {
    read: tenantRoles(PAYMENT_ROLES),
    create: () => false,
    update: () => false,
    delete: tenantAdmins,
  },
  fields: [
    { name: 'quote', type: 'relationship', relationTo: 'quotes', required: true, index: true },
    {
      name: 'amount',
      type: 'number',
      required: true,
      admin: { description: 'Amount in minor units, as charged.' },
    },
    {
      name: 'currency',
      type: 'select',
      required: true,
      options: CURRENCIES.map((value) => ({ label: CURRENCY_LABELS[value], value })),
    },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'pending',
      index: true,
      admin: { position: 'sidebar' },
      options: [
        { label: 'Waiting for payment', value: 'pending' },
        { label: 'Paid', value: 'paid' },
        { label: 'Failed: amount or currency did not match', value: 'failed' },
      ],
    },
    {
      name: 'paidAt',
      type: 'date',
      admin: { position: 'sidebar', date: { pickerAppearance: 'dayAndTime' } },
    },
    {
      name: 'stripeSessionId',
      type: 'text',
      required: true,
      unique: true,
      admin: { readOnly: true },
    },
    {
      // The last Stripe event that changed this payment. A repeated event is ignored.
      name: 'stripeEventId',
      type: 'text',
      index: true,
      admin: { readOnly: true },
    },
  ],
}
