import config from '@payload-config'
import { notFound, redirect } from 'next/navigation'
import { getPayload } from 'payload'

import { getDictionary } from '@/i18n/dictionaries'
import { idOf } from '@/lib/ids'
import { resolveLocale } from '@/lib/locale'
import { findSharedGalleryById } from '@/lib/sharedAlbum'
import { isShareToken } from '@/lib/shareTokens'
import { getCurrentTenant } from '@/lib/tenant'

// The link carries the guest secret: keep it out of search engines and referrers.
export const metadata = { robots: { index: false } }

/**
 * A guest's way in: checks the event's guest token, then sends the guest to the event's album.
 * Shows nothing about the album itself, so an unknown or old link gives no clue.
 */
export default async function GuestEntryPage({ params }: PageProps<'/[locale]/events/[slug]/guests/[token]'>) {
  const tenant = await getCurrentTenant()
  if (!tenant) notFound()
  const { locale: requested, slug, token } = await params
  const locale = await resolveLocale(tenant, requested)
  const t = getDictionary(locale).events
  if (!isShareToken(token)) notFound()

  const payload = await getPayload({ config })
  const { docs } = await payload.find({
    collection: 'events',
    where: {
      and: [
        { tenant: { equals: tenant.id } },
        { slug: { equals: slug } },
        { guestToken: { equals: token } },
        { published: { equals: true } },
      ],
    },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })
  const event = docs[0]
  if (!event) notFound()

  const galleryId = idOf(event.gallery)
  const shared = galleryId === undefined ? null : await findSharedGalleryById(tenant, Number(galleryId), locale)
  if (!shared) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-16 text-ivory">
        <p className="text-mist">{t.guestAlbumUnavailable}</p>
      </main>
    )
  }
  redirect(`/s/${shared.token}`)
}
