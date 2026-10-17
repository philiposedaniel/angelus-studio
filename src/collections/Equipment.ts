import type { CollectionConfig } from 'payload'

import { tenantAdmins, tenantRoles } from '@/access'
import { PRODUCTION_ROLES } from '@/collections/Projects'

/**
 * Cameras, lenses, lights and other kit the studio owns. Reservations for a production
 * are made against these records (see `equipment-reservations`).
 */
export const Equipment: CollectionConfig = {
  slug: 'equipment',
  labels: { singular: 'Equipment', plural: 'Equipment' },
  admin: {
    useAsTitle: 'name',
    defaultColumns: ['name', 'category', 'active', 'updatedAt'],
    group: 'Production',
  },
  defaultSort: 'name',
  access: {
    read: tenantRoles(PRODUCTION_ROLES),
    create: tenantRoles(PRODUCTION_ROLES),
    update: tenantRoles(PRODUCTION_ROLES),
    delete: tenantAdmins,
  },
  fields: [
    { name: 'name', type: 'text', required: true, maxLength: 120 },
    { name: 'category', type: 'text', maxLength: 80, admin: { description: 'For example camera, lens or light.' } },
    { name: 'serialNumber', type: 'text', maxLength: 80 },
    {
      name: 'active',
      type: 'checkbox',
      defaultValue: true,
      index: true,
      admin: { position: 'sidebar', description: 'Untick to retire it. Retired kit cannot be reserved.' },
    },
    { name: 'notes', type: 'textarea', maxLength: 2000, admin: { description: 'Internal notes.' } },
  ],
}
