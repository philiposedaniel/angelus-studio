import { notFound } from 'next/navigation'

import { getDictionary } from '@/i18n/dictionaries'
import { shareLocale } from '@/lib/shareLocale'
import { findSharedGallery, findSharedPhotos } from '@/lib/sharedAlbum'
import { getSiteSettings } from '@/lib/site'
import { getCurrentTenant } from '@/lib/tenant'

/** Everything the album and embed pages need, or a 404 when the link is not valid. */
export async function loadSharedAlbum(
  token: string,
  query: Record<string, string | string[] | undefined>,
) {
  const tenant = await getCurrentTenant()
  if (!tenant) notFound()
  const locale = await shareLocale(tenant, query.lang)
  const gallery = await findSharedGallery(tenant, token, locale)
  if (!gallery) notFound()
  const page = Math.max(1, Number(query.page) || 1)
  const photos = await findSharedPhotos(gallery, token, page, locale)
  const settings = await getSiteSettings(tenant.id, locale)
  const t = getDictionary(locale).album
  return {
    gallery,
    photos,
    page,
    locale,
    studioName: settings?.companyName ?? tenant.name,
    t,
    labels: {
      open: t.open,
      close: t.close,
      previous: t.previous,
      next: t.next,
      position: t.position,
    },
  }
}
