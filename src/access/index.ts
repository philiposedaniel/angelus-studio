import type { Access, FieldAccess } from 'payload'

import { isAdmin, isStaff } from './roles'

export * from './roles'

export const anyone: Access = () => true

export const authenticated: Access = ({ req: { user } }) => Boolean(user)

export const adminsOnly: Access = ({ req: { user } }) => isAdmin(user)

export const staffOnly: Access = ({ req: { user } }) => isStaff(user)

/** Administrators see every record; anyone else only their own user record. */
export const adminsOrSelf: Access = ({ req: { user } }) => {
  if (!user) return false
  if (isAdmin(user)) return true
  return { id: { equals: user.id } }
}

/** Staff see everything; the public only sees documents marked as published. */
export const publishedOrStaff: Access = ({ req: { user } }) => {
  if (isStaff(user)) return true
  return { published: { equals: true } }
}

export const adminsOnlyField: FieldAccess = ({ req: { user } }) => isAdmin(user)
