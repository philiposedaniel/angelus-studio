import { APIError, type Access, type CollectionConfig } from 'payload'

import { GALLERY_STAFF_ROLES } from '@/access/galleries'
import { isSuperAdmin, tenantIdsWithRole } from '@/access/roles'
import { ownOrStaff } from '@/collections/GalleryFavorites'

/** Only the studio's gallery staff change a selection: they review it, ask for changes or approve it. */
const staffOnly: Access = ({ req: { user } }) => {
  if (!user) return false
  if (isSuperAdmin(user)) return true
  const staffTenants = tenantIdsWithRole(user, GALLERY_STAFF_ROLES)
  return staffTenants.length ? { tenant: { in: staffTenants } } : false
}

/**
 * A client's selection from one gallery: the photos they picked, submitted for the studio to review.
 * Clients never write this collection directly; the portal's submit action writes it on the server.
 */
export const GallerySelections: CollectionConfig = {
  slug: 'gallery-selections',
  labels: { singular: 'Selection', plural: 'Selections' },
  admin: {
    defaultColumns: ['gallery', 'user', 'status', 'submittedAt'],
    group: 'Client delivery',
    description:
      'Ask for changes by writing feedback and setting the status to "Changes requested". Approve it to lock it as final.',
  },
  access: {
    read: ownOrStaff,
    create: () => false,
    update: staffOnly,
    delete: staffOnly,
  },
  hooks: {
    beforeChange: [
      ({ data, originalDoc }) => {
        if (!data) return data
        const status = data.status ?? originalDoc?.status
        const feedback = data.feedback ?? originalDoc?.feedback
        if (status === 'revision-requested' && !feedback?.trim()) {
          throw new APIError('Write what the client should change before asking for changes.', 400)
        }
        if (status === 'approved' && originalDoc?.status !== 'approved') {
          data.approvedAt = new Date().toISOString()
        }
        return data
      },
    ],
  },
  fields: [
    { name: 'gallery', type: 'relationship', relationTo: 'galleries', required: true, index: true },
    { name: 'user', type: 'relationship', relationTo: 'users', required: true, index: true },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'open',
      options: [
        { label: 'Open', value: 'open' },
        { label: 'Submitted, waiting for review', value: 'submitted' },
        { label: 'Changes requested', value: 'revision-requested' },
        { label: 'Approved and locked', value: 'approved' },
      ],
    },
    { name: 'submittedAt', type: 'date' },
    { name: 'approvedAt', type: 'date' },
    {
      name: 'feedback',
      type: 'textarea',
      maxLength: 2000,
      admin: { description: 'Shown to the client. Required when asking for changes.' },
    },
  ],
}
