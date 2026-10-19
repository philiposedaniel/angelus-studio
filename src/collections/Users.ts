import { APIError, type Access, type CollectionConfig, type FieldAccess, type Where } from 'payload'

import {
  canChangeMemberships,
  canChangePlatformRoles,
  isStaffAnywhere,
  isSuperAdmin,
  PLATFORM_ROLE_LABELS,
  PLATFORM_ROLES,
  superAdminsOnly,
  superAdminsOnlyField,
  TENANT_ROLE_LABELS,
  TENANT_ROLES,
  tenantIdsWithRole,
} from '@/access'
import { GALLERY_STAFF_ROLES } from '@/access/galleries'
import { requireMfaCodeAtLogin } from '@/lib/mfa'

/** Super admins: everyone. Studio admins: members of their studios. Everyone: themselves. */
const readOrManageUsers: Access = ({ req: { user } }) => {
  if (!user) return false
  if (isSuperAdmin(user)) return true
  const self: Where = { id: { equals: user.id } }
  const administered = tenantIdsWithRole(user, ['admin'])
  if (administered.length === 0) return self
  return { or: [self, { 'tenants.tenant': { in: administered } }] }
}

/**
 * Reading also covers gallery staff (photographers, editors…), who need to see their studio's
 * members to assign clients to galleries. Changing accounts stays with studio admins.
 */
const readUsers: Access = ({ req: { user } }) => {
  if (!user) return false
  if (isSuperAdmin(user)) return true
  const self: Where = { id: { equals: user.id } }
  const studios = [
    ...new Set([
      ...tenantIdsWithRole(user, ['admin']),
      ...tenantIdsWithRole(user, GALLERY_STAFF_ROLES),
    ]),
  ]
  if (studios.length === 0) return self
  return { or: [self, { 'tenants.tenant': { in: studios } }] }
}

/**
 * Authenticator secrets and their counters: only server code running without a signed-in user can read
 * or write them (the sign-in and security actions). Anything arriving over the API is refused.
 */
const serverOnlyField: FieldAccess = ({ req }) => !req.user && req.payloadAPI === 'local'

/** Studio admins can turn authenticator sign-in off for members of their studios; super admins for anyone. */
const mfaResetAccess: FieldAccess = ({ req: { user }, doc }) => {
  if (!user) return false
  if (isSuperAdmin(user)) return true
  const administered = tenantIdsWithRole(user, ['admin']).map(String)
  const memberOf = ((doc?.tenants ?? []) as Array<{ tenant?: unknown }>).map((m) =>
    String(typeof m.tenant === 'object' && m.tenant !== null ? (m.tenant as { id: unknown }).id : m.tenant),
  )
  return memberOf.some((id) => administered.includes(id))
}

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
    // Only platform super admins and studio staff can open the admin panel.
    admin: ({ req: { user } }) => isStaffAnywhere(user),
    create: ({ req: { user } }) =>
      isSuperAdmin(user) || tenantIdsWithRole(user, ['admin']).length > 0,
    read: readUsers,
    update: readOrManageUsers,
    // Removing someone from a studio is done by editing memberships; deleting the
    // account affects every studio, so it is reserved for platform super admins.
    delete: superAdminsOnly,
  },
  hooks: {
    beforeLogin: [requireMfaCodeAtLogin],
    beforeChange: [
      async ({ data, operation, originalDoc, req }) => {
        // Turning authenticator sign-in off for someone who lost their phone clears their secret too.
        if (data.mfaReset === true) {
          data.mfaReset = false
          data.mfaEnabled = false
          data.mfaSecret = null
          data.mfaLastCounter = null
          data.mfaFailedAttempts = 0
          data.mfaLockedUntil = null
        }

        // The very first account created through the admin UI becomes the platform owner.
        if (operation === 'create' && !req.user && req.payloadAPI !== 'local') {
          const { totalDocs } = await req.payload.count({ collection: 'users', req })
          data.roles = totalDocs === 0 ? ['super-admin'] : ['user']
          data.tenants = []
          return data
        }

        const actor = req.user
        if (!actor) return data

        if (Array.isArray(data.roles)) {
          const previous: string[] = originalDoc?.roles ?? ['user']
          if (!canChangePlatformRoles(actor, previous, data.roles)) {
            throw new APIError('You are not allowed to assign these roles.', 403)
          }
        }

        if (Array.isArray(data.tenants)) {
          const previous = originalDoc?.tenants ?? []
          if (!canChangeMemberships(actor, originalDoc, previous, data.tenants)) {
            throw new APIError('You are not allowed to change these studio memberships.', 403)
          }
        }

        // Only the account owner or a super admin can change sign-in details.
        const editingOther = operation === 'update' && String(originalDoc?.id) !== String(actor.id)
        if (editingOther && !isSuperAdmin(actor)) {
          const emailChanged = data.email !== undefined && data.email !== originalDoc?.email
          if (emailChanged || data.password) {
            throw new APIError('Only the account owner can change sign-in details.', 403)
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
      label: 'Platform role',
      type: 'select',
      hasMany: true,
      required: true,
      defaultValue: ['user'],
      options: PLATFORM_ROLES.map((value) => ({ label: PLATFORM_ROLE_LABELS[value], value })),
      saveToJWT: true,
      access: {
        create: superAdminsOnlyField,
        update: superAdminsOnlyField,
      },
      admin: { position: 'sidebar' },
    },
    {
      name: 'tenants',
      label: 'Studio memberships',
      type: 'array',
      fields: [
        {
          name: 'tenant',
          type: 'relationship',
          relationTo: 'tenants',
          required: true,
          index: true,
        },
        {
          name: 'roles',
          type: 'select',
          hasMany: true,
          required: true,
          defaultValue: ['client'],
          options: TENANT_ROLES.map((value) => ({ label: TENANT_ROLE_LABELS[value], value })),
        },
      ],
    },
    {
      name: 'mfaEnabled',
      label: 'Authenticator sign-in on',
      type: 'checkbox',
      defaultValue: false,
      access: { create: serverOnlyField, update: serverOnlyField },
      admin: {
        position: 'sidebar',
        readOnly: true,
        description: 'The person turns this on from their Security page in the portal.',
      },
    },
    {
      name: 'mfaReset',
      label: 'Turn off authenticator sign-in',
      type: 'checkbox',
      defaultValue: false,
      access: { create: () => false, update: mfaResetAccess },
      admin: {
        position: 'sidebar',
        description: 'Use this if the person lost their phone. Saving clears their authenticator secret.',
      },
    },
    // Internal to the sign-in checks: never read through the API or the admin panel.
    { name: 'mfaSecret', type: 'text', access: { read: serverOnlyField, create: serverOnlyField, update: serverOnlyField }, admin: { hidden: true } },
    { name: 'mfaLastCounter', type: 'number', access: { read: serverOnlyField, create: serverOnlyField, update: serverOnlyField }, admin: { hidden: true } },
    { name: 'mfaFailedAttempts', type: 'number', access: { read: serverOnlyField, create: serverOnlyField, update: serverOnlyField }, admin: { hidden: true } },
    { name: 'mfaLockedUntil', type: 'date', access: { read: serverOnlyField, create: serverOnlyField, update: serverOnlyField }, admin: { hidden: true } },
  ],
}
