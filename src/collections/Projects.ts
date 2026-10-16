import { APIError, type Access, type CollectionConfig, type FieldAccess, type Where } from 'payload'

import { hasTenantRole, isSuperAdmin, tenantAdmins, tenantIdsWithRole, tenantRoles, type Actor } from '@/access'
import { idOf } from '@/lib/ids'

/** Staff who run productions: plan them, staff them and track their tasks. */
export const PRODUCTION_ROLES = ['admin', 'production-manager'] as const

export const PROJECT_STATUSES = ['planning', 'confirmed', 'in-production', 'delivered', 'closed'] as const

const DAY_MS = 24 * 60 * 60 * 1000

/** Production staff of the project's studio see everything about it. */
const isProductionStaff = (user: Actor, doc: { tenant?: unknown } | undefined) => {
  if (isSuperAdmin(user)) return true
  const tenantId = idOf(doc?.tenant)
  return tenantId !== undefined && hasTenantRole(user, tenantId, PRODUCTION_ROLES)
}

const isOnCrew = (user: Actor, doc: { crew?: unknown } | undefined) =>
  Boolean(user) &&
  Array.isArray(doc?.crew) &&
  (doc.crew as { user?: unknown }[]).some((member) => String(idOf(member.user)) === String(user?.id))

/**
 * Crew and the assigned client can open their own project, read-only. Everything else,
 * including other members of the same studio, sees nothing unless they are production staff.
 */
const readOwnProject: Access = ({ req: { user } }) => {
  if (!user) return false
  if (isSuperAdmin(user)) return true
  const conditions: Where[] = [{ 'crew.user': { equals: user.id } }, { clientUser: { equals: user.id } }]
  const staffIds = tenantIdsWithRole(user, PRODUCTION_ROLES)
  if (staffIds.length > 0) conditions.push({ tenant: { in: staffIds } })
  return { or: conditions }
}

/** Internal fields, such as the quote and notes, are for production staff only. */
const staffOnly: FieldAccess = ({ req: { user }, doc }) => isProductionStaff(user, doc)

/** Crew see who is on the job and the task list; clients do not. */
const staffOrCrew: FieldAccess = ({ req: { user }, doc }) => isProductionStaff(user, doc) || isOnCrew(user, doc)

/** A 24-hour clock time, such as 08:30 or 17:05. */
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/

/** The start and end of a calendar day, from a date-only value such as "2026-11-14". */
const dayBounds = (ymd: string) => {
  const start = new Date(`${ymd.slice(0, 10)}T00:00:00.000Z`)
  return { start: start.toISOString(), end: new Date(start.getTime() + DAY_MS).toISOString() }
}

/**
 * A production that has been paid for: created when a quote's deposit arrives (see
 * src/lib/projects.ts), then planned by staff. Crew are checked against every other project
 * on the same day, so one person is never booked twice.
 */
export const Projects: CollectionConfig = {
  slug: 'projects',
  labels: { singular: 'Project', plural: 'Projects' },
  admin: {
    useAsTitle: 'title',
    defaultColumns: ['title', 'shootDate', 'status', 'updatedAt'],
    group: 'Production',
  },
  defaultSort: 'shootDate',
  access: {
    read: readOwnProject,
    create: tenantRoles(PRODUCTION_ROLES),
    update: tenantRoles(PRODUCTION_ROLES),
    delete: tenantAdmins,
  },
  hooks: {
    beforeChange: [
      async ({ data, originalDoc, req }) => {
        const shootDate = data.shootDate ?? originalDoc?.shootDate
        const crew: { user: unknown; role?: string | null }[] = data.crew ?? originalDoc?.crew ?? []
        const tenantId = idOf(data.tenant ?? originalDoc?.tenant)
        if (tenantId === undefined) return data

        // The assigned client must also belong to this studio.
        // A project may have no client yet, which reads back as null.
        const clientId = idOf(data.clientUser ?? originalDoc?.clientUser)
        if (clientId) {
          const client = await req.payload.findByID({ collection: 'users', id: clientId, depth: 0, overrideAccess: true })
          const belongs = (client.tenants ?? []).some((m) => String(idOf(m.tenant)) === String(tenantId))
          if (!belongs) throw new APIError('The client must be a member of this studio.', 400)
        }

        // Crew must belong to this studio, whatever the form offered.
        for (const member of crew) {
          const userId = idOf(member.user)
          if (userId === undefined) continue
          const user = await req.payload.findByID({ collection: 'users', id: userId, depth: 0, overrideAccess: true })
          const belongs = (user.tenants ?? []).some((m) => String(idOf(m.tenant)) === String(tenantId))
          if (!belongs) throw new APIError('Crew must be members of this studio.', 400)
        }

        // One person cannot be booked on two projects on the same day.
        if (shootDate && crew.length > 0) {
          const { start, end } = dayBounds(shootDate)
          const crewIds = crew.map((m) => idOf(m.user)).filter((id): id is number | string => id !== undefined)
          const { docs } = await req.payload.find({
            collection: 'projects',
            where: {
              and: [
                { tenant: { equals: tenantId } },
                { shootDate: { greater_than_equal: start } },
                { shootDate: { less_than: end } },
                { 'crew.user': { in: crewIds } },
                ...(originalDoc?.id ? [{ id: { not_equals: originalDoc.id } }] : []),
              ],
            },
            depth: 0,
            limit: 5,
            overrideAccess: true,
            req,
          })
          if (docs.length > 0) {
            throw new APIError(
              `A crew member is already booked that day on "${docs[0]!.title}". Choose another person or date.`,
              400,
            )
          }
        }
        return data
      },
    ],
  },
  fields: [
    { name: 'title', type: 'text', required: true, maxLength: 200 },
    {
      name: 'quote',
      type: 'relationship',
      relationTo: 'quotes',
      index: true,
      access: { read: staffOnly },
      admin: { description: 'The paid quote this project came from. Set automatically when the deposit arrives.' },
    },
    { name: 'clientName', type: 'text', required: true, maxLength: 120, access: { read: staffOnly } },
    { name: 'clientEmail', type: 'email', access: { read: staffOnly } },
    {
      name: 'clientUser',
      type: 'relationship',
      relationTo: 'users',
      index: true,
      access: { read: staffOnly },
      admin: { position: 'sidebar', description: 'The client who sees this project in their portal.' },
      // Offer only members of the project's own studio.
      filterOptions: ({ data }) => (data?.tenant ? { 'tenants.tenant': { equals: data.tenant } } : false),
    },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'planning',
      index: true,
      admin: { position: 'sidebar' },
      options: PROJECT_STATUSES.map((value) => ({
        label: value.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase()),
        value,
      })),
    },
    {
      name: 'shootDate',
      type: 'date',
      index: true,
      admin: { position: 'sidebar', date: { pickerAppearance: 'dayOnly' }, description: 'The day the crew works.' },
    },
    { name: 'location', type: 'text', maxLength: 200 },
    {
      name: 'crew',
      type: 'array',
      access: { read: staffOrCrew },
      admin: { description: 'People working on this project, and their role.' },
      fields: [
        {
          name: 'user',
          type: 'relationship',
          relationTo: 'users',
          required: true,
          // Offer only members of the project's own studio.
          filterOptions: ({ data }) =>
            data?.tenant ? { 'tenants.tenant': { equals: data.tenant } } : false,
        },
        { name: 'role', type: 'text', maxLength: 80 },
      ],
    },
    {
      name: 'tasks',
      type: 'array',
      access: { read: staffOrCrew },
      fields: [
        { name: 'title', type: 'text', required: true, maxLength: 200 },
        { name: 'dueDate', type: 'date', admin: { date: { pickerAppearance: 'dayOnly' } } },
        { name: 'done', type: 'checkbox', defaultValue: false },
      ],
    },
    {
      name: 'callSheet',
      type: 'group',
      // The day plan is for the crew: staff and crew read it, clients never do.
      access: { read: staffOrCrew },
      admin: { description: 'The day plan for the crew: where to meet and what happens when.' },
      fields: [
        { name: 'meetingPoint', type: 'text', maxLength: 200 },
        { name: 'notes', type: 'textarea', maxLength: 2000, admin: { description: 'Shared with the crew.' } },
        {
          name: 'schedule',
          type: 'array',
          maxRows: 50,
          fields: [
            {
              name: 'time',
              type: 'text',
              required: true,
              maxLength: 5,
              admin: { description: '24-hour time, such as 08:30.' },
              validate: (value: unknown) =>
                (typeof value === 'string' && TIME_PATTERN.test(value)) || 'Use 24-hour time, such as 08:30.',
            },
            { name: 'item', type: 'text', required: true, maxLength: 200 },
            { name: 'location', type: 'text', maxLength: 200 },
          ],
        },
      ],
    },
    { name: 'notes', type: 'textarea', access: { read: staffOnly }, admin: { description: 'Internal notes.' } },
  ],
}
