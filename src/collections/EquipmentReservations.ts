import { APIError, type CollectionConfig } from 'payload'

import { tenantRoles } from '@/access'
import { PRODUCTION_ROLES } from '@/collections/Projects'
import { idOf } from '@/lib/ids'

/**
 * Kit set aside for one production over a time range. No two reservations of the same piece of
 * kit may overlap. The check here gives a readable message; the database refuses the overlap too
 * (see the exclusion constraint in the migration), so two requests at once cannot both win.
 */
export const EquipmentReservations: CollectionConfig = {
  slug: 'equipment-reservations',
  labels: { singular: 'Equipment reservation', plural: 'Equipment reservations' },
  admin: {
    defaultColumns: ['equipment', 'project', 'startsAt', 'endsAt'],
    group: 'Production',
  },
  defaultSort: 'startsAt',
  access: {
    read: tenantRoles(PRODUCTION_ROLES),
    create: tenantRoles(PRODUCTION_ROLES),
    update: tenantRoles(PRODUCTION_ROLES),
    delete: tenantRoles(PRODUCTION_ROLES),
  },
  hooks: {
    beforeChange: [
      async ({ data, originalDoc, req }) => {
        const tenantId = idOf(data.tenant ?? originalDoc?.tenant)
        const equipmentId = idOf(data.equipment ?? originalDoc?.equipment)
        const projectId = idOf(data.project ?? originalDoc?.project)
        const startsAt = data.startsAt ?? originalDoc?.startsAt
        const endsAt = data.endsAt ?? originalDoc?.endsAt
        if (tenantId === undefined || equipmentId === undefined || projectId === undefined || !startsAt || !endsAt) {
          throw new APIError('Choose the kit, the production and the time it is needed.', 400)
        }
        if (new Date(endsAt).getTime() <= new Date(startsAt).getTime()) {
          throw new APIError('The reservation must end after it starts.', 400)
        }

        // Check-out and return are recorded by staff as the kit moves. A return needs a check-out
        // first, and the kit cannot come back before it left. Clearing a field passes null here.
        const checkedOutAt = 'checkedOutAt' in data ? data.checkedOutAt : originalDoc?.checkedOutAt
        const returnedAt = 'returnedAt' in data ? data.returnedAt : originalDoc?.returnedAt
        if (returnedAt && !checkedOutAt) {
          throw new APIError('Record when the kit left the studio before recording its return.', 400)
        }
        if (returnedAt && checkedOutAt && new Date(returnedAt).getTime() <= new Date(checkedOutAt).getTime()) {
          throw new APIError('The kit must come back after it was checked out.', 400)
        }

        // The kit and the production must both belong to this studio.
        const equipment = await req.payload.findByID({
          collection: 'equipment',
          id: equipmentId,
          depth: 0,
          overrideAccess: true,
        })
        if (String(idOf(equipment.tenant)) !== String(tenantId)) {
          throw new APIError('That kit belongs to another studio.', 400)
        }
        if (!equipment.active) throw new APIError(`"${equipment.name}" is retired and cannot be reserved.`, 400)

        const project = await req.payload.findByID({ collection: 'projects', id: projectId, depth: 0, overrideAccess: true })
        if (String(idOf(project.tenant)) !== String(tenantId)) {
          throw new APIError('That production belongs to another studio.', 400)
        }

        // Another reservation of the same kit that overlaps this time range, not counting this one.
        const { docs } = await req.payload.find({
          collection: 'equipment-reservations',
          where: {
            and: [
              { tenant: { equals: tenantId } },
              { equipment: { equals: equipmentId } },
              { startsAt: { less_than: endsAt } },
              { endsAt: { greater_than: startsAt } },
              ...(originalDoc?.id ? [{ id: { not_equals: originalDoc.id } }] : []),
            ],
          },
          depth: 0,
          limit: 1,
          overrideAccess: true,
          req,
        })
        if (docs.length > 0) {
          throw new APIError(
            `"${equipment.name}" is already reserved for another production in that time. Choose another time or piece of kit.`,
            400,
          )
        }
        return data
      },
    ],
  },
  fields: [
    {
      name: 'equipment',
      type: 'relationship',
      relationTo: 'equipment',
      required: true,
      index: true,
    },
    {
      name: 'project',
      type: 'relationship',
      relationTo: 'projects',
      required: true,
      index: true,
    },
    {
      name: 'startsAt',
      type: 'date',
      required: true,
      index: true,
      admin: { date: { pickerAppearance: 'dayAndTime' }, position: 'sidebar' },
    },
    {
      name: 'endsAt',
      type: 'date',
      required: true,
      admin: { date: { pickerAppearance: 'dayAndTime' }, position: 'sidebar' },
    },
    {
      name: 'checkedOutAt',
      type: 'date',
      label: 'Checked out at',
      admin: {
        date: { pickerAppearance: 'dayAndTime' },
        position: 'sidebar',
        description: 'When the kit left the studio. Leave empty until it does.',
      },
    },
    {
      name: 'returnedAt',
      type: 'date',
      label: 'Returned at',
      admin: {
        date: { pickerAppearance: 'dayAndTime' },
        position: 'sidebar',
        description: 'When the kit came back. Needs a check-out time first.',
      },
    },
    { name: 'notes', type: 'textarea', maxLength: 1000 },
  ],
}
