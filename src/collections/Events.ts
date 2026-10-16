import { APIError, type Access, type CollectionConfig, type Where } from 'payload'

import { isStaffAnywhere, isSuperAdmin, tenantContentEditors, tenantIdsWithRole } from '@/access'
import { uniqueSlugPerTenant } from '@/hooks/uniqueSlugPerTenant'
import { parseVideoUrl } from '@/lib/embeds'
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
  if (ids.length === 0) return listed
  return { or: [listed, { tenant: { in: ids } }] }
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
    beforeValidate: [uniqueSlugPerTenant('events')],
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
      // An event's guest list goes with it.
      async ({ id, req }) => {
        await req.payload.delete({
          collection: 'event-guests',
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
      name: 'guestToken',
      type: 'text',
      unique: true,
      admin: { hidden: true },
      // Only studio staff may read it; the public API never returns it.
      // Staff only. The collection's own filter already keeps other studios' events out of reach.
      access: { read: ({ req: { user } }) => isStaffAnywhere(user) },
    },
    {
      name: 'guestLink',
      type: 'ui',
      admin: { components: { Field: '@/components/admin/EventGuestLinkField#EventGuestLinkField' } },
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
  ],
}
