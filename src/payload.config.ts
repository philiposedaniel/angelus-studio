import { postgresAdapter } from '@payloadcms/db-postgres'
import { multiTenantPlugin } from '@payloadcms/plugin-multi-tenant'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import path from 'path'
import { buildConfig } from 'payload'
import sharp from 'sharp'
import { fileURLToPath } from 'url'

import { Galleries } from './collections/Galleries'
import { GalleryDownloads } from './collections/GalleryDownloads'
import { GalleryFavorites } from './collections/GalleryFavorites'
import { GalleryPhotos } from './collections/GalleryPhotos'
import { Media } from './collections/Media'
import { isSuperAdmin } from './access/roles'
import { Services } from './collections/Services'
import { Pages } from './collections/Pages'
import { Inquiries } from './collections/Inquiries'
import { SiteSettings } from './collections/SiteSettings'
import { Tenants } from './collections/Tenants'
import { Users } from './collections/Users'
import { DEFAULT_LOCALE, LOCALE_LABELS, LOCALES } from './i18n/config'
import { buildGalleryZip, cleanupGalleryZips } from './jobs/galleryZips'
import { migrations } from './migrations'
import type { Config } from './payload-types'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

if (!process.env.PAYLOAD_SECRET) {
  throw new Error('PAYLOAD_SECRET is not set. Copy .env.example to .env and fill it in.')
}

export default buildConfig({
  admin: {
    user: Users.slug,
    meta: { titleSuffix: ' | Angelus Admin' },
    importMap: {
      baseDir: path.resolve(dirname),
    },
  },
  serverURL: process.env.NEXT_PUBLIC_SERVER_URL,
  collections: [
    Tenants,
    Users,
    Media,
    Pages,
    Services,
    SiteSettings,
    Galleries,
    GalleryPhotos,
    GalleryFavorites,
    GalleryDownloads,
    Inquiries,
  ],
  localization: {
    locales: LOCALES.map((code) => ({ code, label: LOCALE_LABELS[code] })),
    defaultLocale: DEFAULT_LOCALE,
    // Untranslated content shows the English version instead of an empty field.
    fallback: true,
  },
  jobs: {
    tasks: [buildGalleryZip, cleanupGalleryZips],
    // Background jobs (ZIP building, cleanup) run inside the app process every few seconds.
    // Set PAYLOAD_JOBS_AUTORUN=false where another process runs them, and in tests.
    autoRun: [{ cron: '*/5 * * * * *', queue: 'default', limit: 2 }],
    shouldAutoRun: () => process.env.PAYLOAD_JOBS_AUTORUN !== 'false',
    deleteJobOnComplete: true,
  },
  editor: lexicalEditor(),
  secret: process.env.PAYLOAD_SECRET,
  typescript: {
    outputFile: path.resolve(dirname, 'payload-types.ts'),
  },
  db: postgresAdapter({
    pool: {
      connectionString: process.env.DATABASE_URL || '',
    },
    migrationDir: path.resolve(dirname, 'migrations'),
    // Development pushes schema changes automatically; production only runs committed migrations.
    push: process.env.NODE_ENV !== 'production' && process.env.PAYLOAD_DB_PUSH !== 'false',
    prodMigrations: migrations,
  }),
  sharp,
  graphQL: { disable: true },
  plugins: [
    multiTenantPlugin<Config>({
      tenantsSlug: 'tenants',
      collections: {
        media: {},
        pages: {},
        services: {},
        'site-settings': { isGlobal: true },
        galleries: {},
        'gallery-photos': {},
        'gallery-favorites': {},
        'gallery-downloads': {},
        inquiries: {},
      },
      tenantsArrayField: {
        includeDefaultField: false,
        arrayFieldName: 'tenants',
        arrayTenantFieldName: 'tenant',
      },
      userHasAccessToAllTenants: (user) => isSuperAdmin(user),
    }),
  ],
})
