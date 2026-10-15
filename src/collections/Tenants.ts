import type { CollectionConfig } from 'payload'

import { superAdminsOnly, tenantRoles } from '@/access'
import { DEFAULT_LOCALE, LOCALES, LOCALE_LABELS } from '@/i18n/config'

/**
 * A studio using the platform. Angelus Media Productions is the first tenant; other
 * studios can be added later when the platform is offered as a service.
 */
export const Tenants: CollectionConfig = {
  slug: 'tenants',
  admin: {
    useAsTitle: 'name',
    defaultColumns: ['name', 'domain', 'languages'],
  },
  access: {
    // The multi-tenant plugin limits non-super-admins to their own studios.
    read: ({ req: { user } }) => Boolean(user),
    create: superAdminsOnly,
    update: tenantRoles(['admin'], 'id'),
    delete: superAdminsOnly,
  },
  fields: [
    { name: 'name', type: 'text', required: true },
    {
      name: 'slug',
      type: 'text',
      required: true,
      unique: true,
      index: true,
      validate: (value: string | null | undefined) =>
        !value ||
        /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) ||
        'Use lowercase letters, numbers and hyphens.',
    },
    {
      name: 'domain',
      type: 'text',
      unique: true,
      index: true,
      admin: {
        description: 'Host name this studio’s public website is served on, e.g. angelusmedia.com',
      },
      validate: (value: string | null | undefined) =>
        !value ||
        /^[a-z0-9.-]+(:\d+)?$/.test(value) ||
        'Host name only, lowercase, without https:// or a path.',
    },
    {
      name: 'languages',
      label: 'Website languages',
      type: 'select',
      hasMany: true,
      required: true,
      defaultValue: [DEFAULT_LOCALE],
      options: LOCALES.map((value) => ({ label: LOCALE_LABELS[value], value })),
      admin: { description: 'Languages this studio’s public website offers.' },
    },
    {
      name: 'defaultLocale',
      label: 'Default language',
      type: 'select',
      required: true,
      defaultValue: DEFAULT_LOCALE,
      options: LOCALES.map((value) => ({ label: LOCALE_LABELS[value], value })),
      validate: (value: string | null | undefined, { siblingData }: { siblingData: Partial<{ languages: string[] }> }) =>
        !value ||
        (siblingData.languages ?? []).includes(value) ||
        'The default language must be one of the website languages.',
    },
  ],
}
