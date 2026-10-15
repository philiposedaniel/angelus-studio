import { APIError, type CollectionConfig } from 'payload'

import {
  adminsOnly,
  adminsOnlyField,
  adminsOrSelf,
  canChangeRoles,
  DEFAULT_ROLE,
  isStaff,
  ROLE_LABELS,
  ROLES,
} from '@/access'

export const Users: CollectionConfig = {
  slug: 'users',
  admin: {
    useAsTitle: 'email',
    defaultColumns: ['email', 'name', 'roles'],
  },
  auth: {
    maxLoginAttempts: 5,
    lockTime: 15 * 60 * 1000,
    cookies: {
      sameSite: 'Lax',
      secure: process.env.NODE_ENV === 'production',
    },
  },
  access: {
    // Only staff can open the admin panel; clients get their own portal later.
    admin: ({ req: { user } }) => isStaff(user),
    // Accounts are created by administrators until client self-registration exists.
    create: adminsOnly,
    read: adminsOrSelf,
    update: adminsOrSelf,
    delete: adminsOnly,
  },
  hooks: {
    beforeChange: [
      async ({ data, operation, originalDoc, req }) => {
        // The very first account created through the admin UI becomes the owner.
        if (operation === 'create' && !req.user && req.payloadAPI !== 'local') {
          const { totalDocs } = await req.payload.count({ collection: 'users', req })
          data.roles = totalDocs === 0 ? ['super-admin'] : [DEFAULT_ROLE]
          return data
        }

        if (req.user && Array.isArray(data.roles)) {
          const previous: string[] = originalDoc?.roles ?? []
          if (!canChangeRoles(req.user, previous, data.roles)) {
            throw new APIError('You are not allowed to assign these roles.', 403)
          }
        }
        return data
      },
    ],
  },
  fields: [
    {
      name: 'name',
      type: 'text',
    },
    {
      name: 'roles',
      type: 'select',
      hasMany: true,
      required: true,
      defaultValue: [DEFAULT_ROLE],
      options: ROLES.map((value) => ({ label: ROLE_LABELS[value], value })),
      saveToJWT: true,
      access: {
        create: adminsOnlyField,
        update: adminsOnlyField,
      },
    },
  ],
}
