import { APIError, type CollectionConfig } from 'payload'

import { tenantAdmins, tenantRoles } from '@/access'
import { INQUIRY_STAFF_ROLES } from '@/collections/Inquiries'
import { CURRENCIES, CURRENCY_LABELS, MAX_AMOUNT, MAX_QUANTITY, quoteTotals } from '@/lib/money'
import { newShareToken } from '@/lib/shareTokens'

/** Smallest amount Stripe will charge; a deposit below it cannot be paid online. */
export const MIN_DEPOSIT = 50

export const QUOTE_STATUSES = ['draft', 'sent', 'deposit-paid', 'cancelled'] as const

/** Context flag set only by the verified Stripe webhook. The only way a quote becomes paid. */
export const STRIPE_PAYMENT_CONTEXT = { stripePayment: true } as const

const isWholeNumber = (value: unknown, min: number, max: number) =>
  typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max

/**
 * A priced offer sent to a client. The client opens it through a private link
 * (`/<language>/quote/<publicToken>`), pays the deposit and the status moves to deposit-paid.
 * Totals are always computed here, never taken from the request.
 */
export const Quotes: CollectionConfig = {
  slug: 'quotes',
  labels: { singular: 'Quote', plural: 'Quotes' },
  admin: {
    useAsTitle: 'title',
    defaultColumns: ['title', 'clientName', 'status', 'depositAmount', 'updatedAt'],
    group: 'Sales',
  },
  defaultSort: '-updatedAt',
  access: {
    read: tenantRoles(INQUIRY_STAFF_ROLES),
    create: tenantRoles(INQUIRY_STAFF_ROLES),
    update: tenantRoles(INQUIRY_STAFF_ROLES),
    delete: tenantAdmins,
  },
  hooks: {
    beforeChange: [
      ({ data, originalDoc, operation, req }) => {
        const paidBefore = originalDoc?.status === 'deposit-paid'
        const fromStripe = req.context?.stripePayment === true
        const nextStatus = data.status ?? originalDoc?.status ?? 'draft'

        // Payment state is owned by the webhook: staff cannot mark a quote paid or undo it.
        if (nextStatus === 'deposit-paid' && !paidBefore && !fromStripe) {
          throw new APIError('A quote is marked as paid only when its deposit payment arrives.', 400)
        }
        if (paidBefore && nextStatus !== 'deposit-paid' && !fromStripe) {
          throw new APIError('A paid quote cannot change status. Create a new quote instead.', 400)
        }

        const lineItems = data.lineItems ?? originalDoc?.lineItems ?? []
        const depositPercent = data.depositPercent ?? originalDoc?.depositPercent ?? 0
        // Only fields present in this save count: a save that leaves prices out changes none.
        const pricingChanged =
          (data.lineItems !== undefined &&
            JSON.stringify(data.lineItems) !== JSON.stringify(originalDoc?.lineItems)) ||
          (data.depositPercent !== undefined && data.depositPercent !== originalDoc?.depositPercent) ||
          (data.currency !== undefined && data.currency !== originalDoc?.currency)
        if (paidBefore && pricingChanged && !fromStripe) {
          throw new APIError('The prices of a paid quote cannot change.', 400)
        }

        const { totalAmount, depositAmount } = quoteTotals(lineItems, depositPercent)
        if (nextStatus === 'sent' && depositAmount < MIN_DEPOSIT) {
          throw new APIError('The deposit is too small to be paid online. Raise the total or the deposit percentage.', 400)
        }

        return {
          ...data,
          totalAmount,
          depositAmount,
          // Set once, on create. The link is never taken from the request.
          publicToken: operation === 'create' || !originalDoc?.publicToken
            ? newShareToken()
            : originalDoc.publicToken,
        }
      },
    ],
  },
  fields: [
    { name: 'title', type: 'text', required: true, maxLength: 200 },
    { name: 'clientName', type: 'text', required: true, maxLength: 120 },
    { name: 'clientEmail', type: 'email', required: true },
    {
      name: 'inquiry',
      type: 'relationship',
      relationTo: 'inquiries',
      index: true,
      admin: { description: 'The website request this quote answers, if any.' },
    },
    {
      name: 'currency',
      type: 'select',
      required: true,
      defaultValue: 'eur',
      options: CURRENCIES.map((value) => ({ label: CURRENCY_LABELS[value], value })),
    },
    {
      name: 'lineItems',
      type: 'array',
      required: true,
      minRows: 1,
      maxRows: 50,
      fields: [
        { name: 'description', type: 'text', required: true, maxLength: 200 },
        {
          name: 'quantity',
          type: 'number',
          required: true,
          defaultValue: 1,
          validate: (value: unknown) =>
            isWholeNumber(value, 1, MAX_QUANTITY) || `Enter a whole number from 1 to ${MAX_QUANTITY}.`,
        },
        {
          name: 'unitAmount',
          type: 'number',
          required: true,
          admin: { description: 'In minor units: 12550 means 125.50.' },
          validate: (value: unknown) =>
            isWholeNumber(value, 0, MAX_AMOUNT) || 'Enter a whole number of minor units (cents).',
        },
      ],
    },
    {
      name: 'depositPercent',
      type: 'number',
      required: true,
      defaultValue: 30,
      admin: { position: 'sidebar', description: 'Share of the total paid online to confirm the booking.' },
      validate: (value: unknown) => isWholeNumber(value, 0, 100) || 'Enter a whole percentage from 0 to 100.',
    },
    {
      name: 'totalAmount',
      type: 'number',
      admin: { readOnly: true, position: 'sidebar', description: 'Calculated from the line items, in minor units.' },
    },
    {
      name: 'depositAmount',
      type: 'number',
      admin: { readOnly: true, position: 'sidebar', description: 'Due now, in minor units. Calculated.' },
    },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'draft',
      index: true,
      admin: { position: 'sidebar' },
      options: [
        { label: 'Draft (staff only)', value: 'draft' },
        { label: 'Sent to client', value: 'sent' },
        { label: 'Deposit paid', value: 'deposit-paid' },
        { label: 'Cancelled', value: 'cancelled' },
      ],
    },
    {
      name: 'validUntil',
      type: 'date',
      admin: {
        position: 'sidebar',
        date: { pickerAppearance: 'dayOnly' },
        description: 'After this day the client can no longer pay. Leave empty for no limit.',
      },
    },
    {
      name: 'publicLink',
      type: 'ui',
      admin: { components: { Field: '@/components/admin/QuoteLinkField#QuoteLinkField' } },
    },
    {
      name: 'publicToken',
      type: 'text',
      unique: true,
      admin: { hidden: true },
    },
    {
      name: 'notes',
      type: 'textarea',
      admin: { description: 'Internal notes. Not shown to the client.' },
    },
  ],
}
