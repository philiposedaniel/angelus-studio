import type { CollectionConfig } from 'payload'

import { galleryRead, galleryStaff, isGalleryStaffFor } from '@/access/galleries'
import { uniqueSlugPerTenant } from '@/hooks/uniqueSlugPerTenant'
import { queueGalleryNotice } from '@/lib/galleryNotices'
import { idOf } from '@/lib/ids'
import { newShareToken } from '@/lib/shareTokens'

/**
 * A private photo gallery delivered to one or more clients of a studio.
 * Clients only ever see galleries they are assigned to, once published and until expiry.
 */
export const Galleries: CollectionConfig = {
  slug: 'galleries',
  admin: {
    useAsTitle: 'title',
    defaultColumns: ['title', 'status', 'expiresAt', 'updatedAt'],
    group: 'Client delivery',
  },
  access: {
    read: galleryRead(),
    create: galleryStaff,
    update: galleryStaff,
    delete: galleryStaff,
  },
  hooks: {
    beforeValidate: [uniqueSlugPerTenant('galleries')],
    beforeChange: [
      // The share token is only ever set here, never taken from the request. Turning sharing
      // off forgets it, so turning it back on issues a new link and the old one stops working.
      ({ data, originalDoc }) => {
        const enabled = data.shareEnabled ?? originalDoc?.shareEnabled ?? false
        if (!enabled) return { ...data, shareToken: null }
        const keep = originalDoc?.shareEnabled && originalDoc.shareToken
        return { ...data, shareToken: keep ? originalDoc.shareToken : newShareToken() }
      },
    ],
    afterChange: [
      // Published with notification on and not yet sent: the clients get their link once, in the background.
      async ({ doc, req }) => {
        if (doc.status === 'published' && doc.notifyClients && !doc.clientsNotifiedAt && doc.clients?.length) {
          await queueGalleryNotice(req, doc.id)
        }
        return doc
      },
    ],
  },
  fields: [
    { name: 'title', type: 'text', required: true, localized: true },
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
    { name: 'description', type: 'textarea', localized: true },
    {
      name: 'clients',
      type: 'relationship',
      relationTo: 'users',
      hasMany: true,
      index: true,
      admin: { description: 'People who can see this gallery in their client portal.' },
      // Only offer members of the gallery's own studio.
      filterOptions: ({ data }) =>
        data?.tenant ? { 'tenants.tenant': { equals: data.tenant } } : false,
    },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'draft',
      index: true,
      options: [
        { label: 'Draft (only staff can see it)', value: 'draft' },
        { label: 'Published to clients', value: 'published' },
      ],
      admin: { position: 'sidebar' },
    },
    {
      name: 'notifyClients',
      type: 'checkbox',
      label: 'Email clients when published',
      defaultValue: false,
      admin: {
        position: 'sidebar',
        description:
          'Email each client a link when this gallery is published. Sent once, the first time the gallery is published with this on. If the gallery is already published when this is turned on, the clients are emailed straight away. Needs email to be set up.',
      },
    },
    {
      name: 'clientsNotifiedAt',
      type: 'date',
      // Written only by the background job that sends the link, so the record shows when it went out.
      access: {
        // The admin form passes its values as `data` rather than `doc`, so read the studio from either.
        read: ({ req: { user }, doc, data }) => isGalleryStaffFor(user, idOf((doc ?? data)?.tenant)),
        create: () => false,
        update: () => false,
      },
      admin: {
        position: 'sidebar',
        readOnly: true,
        date: { pickerAppearance: 'dayAndTime' },
        condition: (data) => Boolean(data?.clientsNotifiedAt),
        description: 'When the clients were emailed the link.',
      },
    },
    {
      name: 'expiresAt',
      type: 'date',
      admin: {
        position: 'sidebar',
        description:
          'After this date clients can no longer open the gallery. Leave empty for no expiry.',
      },
    },
    {
      name: 'watermarkText',
      type: 'text',
      maxLength: 60,
      admin: {
        description:
          'Written on the preview copies clients and album viewers see, such as your studio name. Leave empty for no watermark. Originals are never changed.',
      },
    },
    {
      name: 'allowDownloads',
      type: 'checkbox',
      defaultValue: true,
      admin: {
        position: 'sidebar',
        description: 'Let clients download full-resolution originals.',
      },
    },
    {
      name: 'selectionLimit',
      type: 'number',
      min: 1,
      max: 10000,
      admin: {
        position: 'sidebar',
        description:
          'Most photos a client may select here. Leave empty for no limit. Clients select by marking favorites.',
      },
    },
    {
      name: 'shareEnabled',
      type: 'checkbox',
      label: 'Share by link',
      defaultValue: false,
      admin: {
        position: 'sidebar',
        description:
          'Anyone with the link can view web-size copies (never originals), and the album can be embedded on a website. Turn off to revoke the link; turning it on again creates a new one.',
      },
    },
    {
      name: 'shareToken',
      type: 'text',
      index: true,
      admin: { hidden: true },
      access: {
        // Only the studio's staff may see the secret part of the link.
        // The admin form passes its values as `data` rather than `doc`, so read the studio from either.
        read: ({ req: { user }, doc, data }) => isGalleryStaffFor(user, idOf((doc ?? data)?.tenant)),
      },
    },
    {
      name: 'shareLink',
      type: 'ui',
      admin: {
        position: 'sidebar',
        condition: (data) => Boolean(data?.shareEnabled),
        components: { Field: '@/components/admin/ShareLinkField#ShareLinkField' },
      },
    },
  ],
}
