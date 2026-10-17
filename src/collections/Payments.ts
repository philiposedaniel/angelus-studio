import { APIError, type CollectionConfig } from 'payload'

import { tenantAdmins, tenantRoles } from '@/access'
import { CURRENCIES, CURRENCY_LABELS } from '@/lib/money'

/** Staff who see money received. */
export const PAYMENT_ROLES = ['admin', 'finance-manager'] as const

/**
 * Online payments made through Stripe Checkout, for a quote (deposit or balance) or for an event
 * ticket (a registration). Created when a client or ticket buyer starts paying and
 * confirmed only by a verified Stripe webhook (see src/lib/stripeWebhook.ts). Nobody
 * can create, change or delete these through the admin or the API.
 */
export const Payments: CollectionConfig = {
  slug: 'payments',
  labels: { singular: 'Payment', plural: 'Payments' },
  admin: {
    useAsTitle: 'stripeSessionId',
    defaultColumns: ['kind', 'quote', 'registration', 'amount', 'currency', 'status', 'paidAt'],
    group: 'Sales',
  },
  defaultSort: '-createdAt',
  access: {
    read: tenantRoles(PAYMENT_ROLES),
    create: () => false,
    update: () => false,
    delete: tenantAdmins,
  },
  hooks: {
    beforeValidate: [
      // Every payment is for exactly one thing: a quote, or a ticket registration.
      ({ data, originalDoc }) => {
        const kind = data?.kind ?? originalDoc?.kind
        const quote = data?.quote ?? originalDoc?.quote
        const registration = data?.registration ?? originalDoc?.registration
        if (kind === 'ticket' ? !registration || quote : !quote || registration) {
          throw new APIError('A payment is for a quote, or for a ticket registration.', 400)
        }
        return data
      },
    ],
  },
  fields: [
    { name: 'quote', type: 'relationship', relationTo: 'quotes', index: true },
    { name: 'registration', type: 'relationship', relationTo: 'registrations', index: true },
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
      name: 'kind',
      type: 'select',
      required: true,
      defaultValue: 'deposit',
      options: [
        { label: 'Deposit', value: 'deposit' },
        { label: 'Balance', value: 'balance' },
        { label: 'Ticket', value: 'ticket' },
      ],
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
        { label: 'Expired: not paid in time', value: 'expired' },
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
