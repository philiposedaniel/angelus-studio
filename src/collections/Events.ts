import { APIError, type Access, type CollectionConfig, type Where } from 'payload'

import {
  hasTenantRole,
  isSuperAdmin,
  TENANT_STAFF_ROLES,
  tenantContentEditors,
  tenantIdOf,
  tenantIdsWithRole,
} from '@/access'
import { uniqueSlugPerTenant } from '@/hooks/uniqueSlugPerTenant'
import { parseVideoUrl } from '@/lib/embeds'
import { idOf } from '@/lib/ids'
import { INVITATION_STYLE_LABELS, INVITATION_STYLES, isWebAddress, MAX_SCHEDULE_ITEMS } from '@/lib/invitationDesign'
import { MAX_MEAL_OPTIONS } from '@/lib/rsvp'
import { newShareToken } from '@/lib/shareTokens'

/**
 * The public sees published events that are listed on the website; studio staff also see their
 * drafts and private events. Private (unlisted) events are reached only through invitation and
 * guest links, which look them up on the server.
 */
const listedOrTenantStaff: Access = ({ req: { user } }) => {
  if (isSuperAdmin(user)) return true
  const ids = tenantIdsWithRole(user, ['admin', 'production-manager', 'editor'])
  const listed: Where = { and: [{ published: { equals: true } }, { listed: { equals: true } }] }
  // Organizers also see the events they organize, in the studios they still belong to.
  const memberOf = (user?.tenants ?? []).map(tenantIdOf).filter((id) => id !== null)
  const organized: Where | null =
    user && memberOf.length > 0
      ? { and: [{ organizers: { in: [user.id] } }, { tenant: { in: memberOf } }] }
      : null
  const allowed = [listed, ...(organized ? [organized] : []), ...(ids.length > 0 ? [{ tenant: { in: ids } }] : [])]
  return allowed.length === 1 ? listed : { or: allowed }
}

/**
 * An event a studio hosts or covers, with a page for the public and a private guest album.
 * Guests open the album through the event's guest link, which only works for published events
 * and galleries that are shared.
 */
export const Events: CollectionConfig = {
  slug: 'events',
  labels: { singular: 'Event', plural: 'Events' },
  admin: {
    useAsTitle: 'title',
    defaultColumns: ['title', 'startsAt', 'published', 'listed', 'updatedAt'],
    group: 'Events',
  },
  defaultSort: 'startsAt',
  access: {
    read: listedOrTenantStaff,
    create: tenantContentEditors,
    update: tenantContentEditors,
    delete: tenantContentEditors,
  },
  hooks: {
    beforeValidate: [
      uniqueSlugPerTenant('events'),
      // Organizers must be members of the event's studio.
      async ({ data, originalDoc, req }) => {
        const organizers: unknown[] = data?.organizers ?? []
        const tenantId = idOf(data?.tenant ?? originalDoc?.tenant)
        if (!data || organizers.length === 0 || tenantId === undefined) return data
        const { docs } = await req.payload.find({
          collection: 'users',
          where: { id: { in: organizers.map(idOf) } },
          pagination: false,
          depth: 0,
          req,
          overrideAccess: true,
        })
        const members = docs.filter((user) =>
          (user.tenants ?? []).some((membership) => String(tenantIdOf(membership)) === String(tenantId)),
        )
        if (members.length !== organizers.length) {
          throw new APIError('Organizers must be members of this studio.', 400)
        }
        return data
      },
    ],
    beforeChange: [
      ({ data, originalDoc, operation }) => {
        // Set on create, kept on change, never taken from the request.
        const guestToken =
          operation === 'create' || !originalDoc?.guestToken ? newShareToken() : originalDoc.guestToken
        if (data.endsAt && data.startsAt && new Date(data.endsAt) < new Date(data.startsAt)) {
          throw new APIError('The event must end after it starts.', 400)
        }
        return { ...data, guestToken }
      },
    ],
    beforeDelete: [
      // An event's guest list, tables, vendor bookings, waitlist, registrations, promo codes and ticket types go with it.
      async ({ id, req }) => {
        await req.payload.delete({
          collection: 'waitlist-entries',
          where: { event: { equals: id } },
          req,
          overrideAccess: true,
        })
        await req.payload.delete({
          collection: 'registrations',
          where: { event: { equals: id } },
          req,
          overrideAccess: true,
        })
        await req.payload.delete({
          collection: 'promo-codes',
          where: { event: { equals: id } },
          req,
          overrideAccess: true,
        })
        await req.payload.delete({
          collection: 'ticket-types',
          where: { event: { equals: id } },
          req,
          overrideAccess: true,
        })
        await req.payload.delete({
          collection: 'event-vendors',
          where: { event: { equals: id } },
          req,
          overrideAccess: true,
        })
        await req.payload.delete({
          collection: 'event-guests',
          where: { event: { equals: id } },
          req,
          overrideAccess: true,
        })
        await req.payload.delete({
          collection: 'event-tables',
          where: { event: { equals: id } },
          req,
          overrideAccess: true,
        })
      },
    ],
  },
  fields: [
    { name: 'title', type: 'text', required: true, localized: true, maxLength: 200 },
    {
      name: 'slug',
      type: 'text',
      required: true,
      index: true,
      validate: (value: string | null | undefined) =>
        !value ||
        /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) ||
        'Use lowercase letters, numbers and hyphens.',
    },
    {
      name: 'startsAt',
      type: 'date',
      required: true,
      index: true,
      admin: { date: { pickerAppearance: 'dayAndTime' }, position: 'sidebar' },
    },
    {
      name: 'timeZone',
      type: 'text',
      required: true,
      defaultValue: 'Europe/Lisbon',
      admin: { position: 'sidebar', description: 'The time zone the event happens in, e.g. Europe/Lisbon.' },
      validate: (value: string | null | undefined) => {
        if (!value) return 'Enter a time zone.'
        try {
          new Intl.DateTimeFormat('en', { timeZone: value })
          return true
        } catch {
          return 'Use an IANA time zone name, e.g. Europe/Lisbon.'
        }
      },
    },
    {
      name: 'endsAt',
      type: 'date',
      admin: { date: { pickerAppearance: 'dayAndTime' }, position: 'sidebar' },
    },
    { name: 'location', type: 'text', localized: true, maxLength: 200 },
    { name: 'summary', type: 'textarea', localized: true, maxLength: 1000 },
    { name: 'image', type: 'upload', relationTo: 'media' },
    {
      name: 'livestreamUrl',
      type: 'text',
      admin: { description: 'Optional Vimeo or YouTube live link, shown on the event page.' },
      validate: (value: string | null | undefined) =>
        !value || parseVideoUrl(value) !== null || 'Use a Vimeo or YouTube link.',
    },
    {
      name: 'gallery',
      type: 'relationship',
      relationTo: 'galleries',
      admin: {
        description:
          'The album guests see. It must be published and shared (Share link on). Guests reach it through the guest link.',
      },
      filterOptions: ({ data }) => (data?.tenant ? { tenant: { equals: data.tenant } } : false),
    },
    {
      name: 'organizers',
      type: 'relationship',
      relationTo: 'users',
      hasMany: true,
      admin: {
        description:
          'Clients who host this event. They manage its guest list from their portal: add, change and remove guests and copy invitation links.',
      },
      filterOptions: ({ data }) => (data?.tenant ? { 'tenants.tenant': { equals: idOf(data.tenant) } } : false),
    },
    {
      name: 'guestToken',
      type: 'text',
      unique: true,
      admin: { hidden: true },
      // Only staff of the event's own studio may read it; the public API never returns it.
      access: {
        read: ({ req: { user }, doc }) => {
          const tenantId = idOf(doc?.tenant)
          return isSuperAdmin(user) || (tenantId !== undefined && hasTenantRole(user, tenantId, TENANT_STAFF_ROLES))
        },
      },
    },
    {
      name: 'guestLink',
      type: 'ui',
      admin: { components: { Field: '@/components/admin/EventGuestLinkField#EventGuestLinkField' } },
    },
    {
      name: 'invitation',
      label: 'Invitation design',
      type: 'group',
      admin: {
        description:
          'How the invitation page looks. Every guest sees this design above their own reply form and entry code.',
      },
      fields: [
        {
          name: 'style',
          type: 'select',
          defaultValue: 'classic',
          options: INVITATION_STYLES.map((value) => ({ value, label: INVITATION_STYLE_LABELS[value] })),
        },
        {
          name: 'coverImage',
          type: 'upload',
          relationTo: 'media',
          admin: { description: 'Shown at the top. Website media is public, so use a picture meant to be shared.' },
        },
        {
          name: 'headline',
          type: 'text',
          localized: true,
          maxLength: 200,
          admin: { description: 'e.g. "Together with their families, Ana and João invite you". Empty shows "You are invited".' },
        },
        { name: 'message', type: 'textarea', localized: true, maxLength: 2000 },
        {
          name: 'schedule',
          label: 'Programme',
          type: 'array',
          maxRows: MAX_SCHEDULE_ITEMS,
          labels: { singular: 'Moment', plural: 'Moments' },
          fields: [
            {
              type: 'row',
              fields: [
                { name: 'time', type: 'text', required: true, maxLength: 20, admin: { width: '20%', description: 'e.g. 16:00' } },
                { name: 'title', type: 'text', required: true, localized: true, maxLength: 120, admin: { width: '40%' } },
                { name: 'place', type: 'text', localized: true, maxLength: 200, admin: { width: '40%' } },
              ],
            },
          ],
        },
        { name: 'dressCode', type: 'text', localized: true, maxLength: 200 },
        {
          name: 'mapUrl',
          label: 'Map link',
          type: 'text',
          maxLength: 500,
          admin: { description: 'Optional link to the place on a map, starting with https://' },
          validate: isWebAddress,
        },
        {
          name: 'signature',
          type: 'text',
          localized: true,
          maxLength: 200,
          admin: { description: 'Closing line, e.g. "With love, Ana and João".' },
        },
        {
          name: 'previewLink',
          type: 'ui',
          admin: { components: { Field: '@/components/admin/InvitationPreviewField#InvitationPreviewField' } },
        },
      ],
    },
    {
      type: 'collapsible',
      label: 'Invitations and RSVP',
      fields: [
        {
          name: 'rsvpSummary',
          type: 'ui',
          admin: { components: { Field: '@/components/admin/RsvpSummaryField#RsvpSummaryField' } },
        },
        {
          name: 'guestImport',
          type: 'ui',
          admin: { components: { Field: '@/components/admin/GuestImportField#GuestImportField' } },
        },
        {
          name: 'rsvpOpen',
          label: 'Guests can reply',
          type: 'checkbox',
          defaultValue: true,
          admin: { description: 'Untick to close replies. Guests then see their answer but cannot change it.' },
        },
        {
          name: 'rsvpDeadline',
          label: 'Reply by',
          type: 'date',
          admin: {
            date: { pickerAppearance: 'dayAndTime' },
            description: 'Optional. Replies close automatically after this moment.',
          },
        },
        {
          name: 'replyNotices',
          label: 'Email the hosts when a guest replies',
          type: 'checkbox',
          defaultValue: true,
          admin: {
            description:
              "Each reply, and each change to one, is emailed to the event's organizers and to the address below. Needs email sending set up.",
          },
        },
        {
          name: 'replyNoticeEmail',
          label: 'Studio address for notices',
          type: 'email',
          admin: {
            description:
              "Optional, e.g. the studio's events address or a wedding planner. It gets every guest reply (while the box above is ticked) and every vendor confirmation.",
          },
        },
        {
          name: 'mealOptions',
          label: 'Meal choices',
          type: 'array',
          maxRows: MAX_MEAL_OPTIONS,
          labels: { singular: 'Meal', plural: 'Meals' },
          admin: {
            description:
              'Optional. When set, each person coming picks one of these when they reply, and the counts show above, in the guest list download and at check-in. People who chose a meal that is later removed count as not chosen.',
          },
          fields: [{ name: 'label', type: 'text', required: true, localized: true, maxLength: 80, admin: { description: 'e.g. Fish, Meat, Vegetarian, Children\'s menu' } }],
        },
      ],
    },
    {
      type: 'collapsible',
      label: 'Registration and tickets',
      admin: { initCollapsed: false },
      fields: [
        {
          name: 'registrationSummary',
          type: 'ui',
          admin: { components: { Field: '@/components/admin/RegistrationSummaryField#RegistrationSummaryField' } },
        },
      ],
    },
    {
      type: 'collapsible',
      label: 'Seating',
      admin: { initCollapsed: false },
      fields: [
        {
          name: 'seatingPlan',
          type: 'ui',
          admin: { components: { Field: '@/components/admin/SeatingPlanField#SeatingPlanField' } },
        },
      ],
    },
    {
      type: 'collapsible',
      label: 'Vendors',
      admin: { initCollapsed: false },
      fields: [
        {
          name: 'vendorSummary',
          type: 'ui',
          admin: { components: { Field: '@/components/admin/EventVendorsField#EventVendorsField' } },
        },
      ],
    },
    {
      name: 'published',
      type: 'checkbox',
      defaultValue: false,
      index: true,
      admin: { position: 'sidebar' },
    },
    {
      name: 'listed',
      label: 'Show on the website',
      type: 'checkbox',
      defaultValue: true,
      index: true,
      admin: {
        position: 'sidebar',
        description:
          'Untick for private events such as weddings: only people with an invitation or guest link can open them.',
      },
    },
    {
      name: 'reminderEmails',
      label: 'Email a reminder the day before',
      type: 'checkbox',
      defaultValue: true,
      admin: {
        position: 'sidebar',
        description:
          'About a day before the event, guests who are coming and ticket holders get a reminder with their invitation or ticket. Needs email sending set up.',
      },
    },
  ],
}
