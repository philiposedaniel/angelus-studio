import { RichText } from '@payloadcms/richtext-lexical/react'
import { ExternalLink, Images } from 'lucide-react'
import Image from 'next/image'
import Link from 'next/link'

import { PhotoAlbum } from '@/components/album/PhotoAlbum'
import type { Locale } from '@/i18n/config'
import { getDictionary } from '@/i18n/dictionaries'
import { idOf } from '@/lib/ids'
import { embedDocument, parseGooglePhotosUrl, parseVideoUrl } from '@/lib/embeds'
import { findSharedGalleryById, findSharedPhotos } from '@/lib/sharedAlbum'
import type { Media, Page, Tenant } from '@/payload-types'

type Block = NonNullable<Page['layout']>[number]
type Props = { blocks: Page['layout']; locale: Locale; tenant: Tenant }

/** Photos shown inline for an album block; the rest are one click away. */
const INLINE_ALBUM_PHOTOS = 60

const Caption = ({ text }: { text?: string | null }) =>
  text ? <figcaption className="mt-3 text-sm text-mist">{text}</figcaption> : null

async function SharedAlbum({
  block,
  locale,
  tenant,
}: {
  block: Extract<Block, { blockType: 'sharedAlbum' }>
  locale: Locale
  tenant: Tenant
}) {
  const galleryId = idOf(block.gallery)
  const found =
    typeof galleryId === 'number' ? await findSharedGalleryById(tenant, galleryId, locale) : null
  // A gallery that is no longer shared simply disappears from the page.
  if (!found) return null
  const photos = await findSharedPhotos(found.gallery, found.token, 1, locale)
  const t = getDictionary(locale)
  return (
    <figure>
      <PhotoAlbum
        photos={photos.photos.slice(0, INLINE_ALBUM_PHOTOS)}
        labels={{
          open: t.album.open,
          close: t.album.close,
          previous: t.album.previous,
          next: t.album.next,
          position: t.album.position,
        }}
        rowHeight={200}
      />
      <div className="mt-3 flex flex-wrap items-baseline justify-between gap-2">
        <Caption text={block.caption ?? found.gallery.title} />
        <Link
          href={`/s/${found.token}?lang=${locale}`}
          className="text-sm text-gold hover:underline"
        >
          {t.blocks.openAlbum} ({photos.totalDocs})
        </Link>
      </div>
    </figure>
  )
}

/** Renders a page's blocks: text, Vimeo/YouTube, sandboxed embed code, Google Photos cards and albums. */
export async function RenderBlocks({ blocks, locale, tenant }: Props) {
  if (!blocks?.length) return null
  const t = getDictionary(locale).blocks

  return (
    <div className="space-y-16">
      {blocks.map((block) => {
        switch (block.blockType) {
          case 'text':
            return (
              <div key={block.id} className="prose-angelus max-w-3xl">
                <RichText data={block.content} />
              </div>
            )

          case 'video': {
            const video = parseVideoUrl(block.url)
            if (!video) return null
            return (
              <figure key={block.id}>
                <div
                  className="overflow-hidden rounded-xl bg-charcoal"
                  style={{ aspectRatio: block.aspect }}
                >
                  <iframe
                    src={video.src}
                    title={block.caption || video.provider}
                    loading="lazy"
                    allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
                    allowFullScreen
                    referrerPolicy="strict-origin-when-cross-origin"
                    className="size-full border-0"
                  />
                </div>
                <Caption text={block.caption} />
              </figure>
            )
          }

          case 'embedCode':
            return (
              <figure key={block.id}>
                <iframe
                  srcDoc={embedDocument(block.code)}
                  title={block.title}
                  loading="lazy"
                  // Scripts run, but in a unique origin: no access to this site's cookies or page.
                  sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox allow-presentation allow-forms"
                  allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
                  allowFullScreen
                  className="w-full rounded-xl border-0 bg-charcoal"
                  style={
                    block.size === 'fixed'
                      ? { height: block.height ?? 480 }
                      : { aspectRatio: block.size }
                  }
                />
                <Caption text={block.caption} />
              </figure>
            )

          case 'googlePhotos': {
            const url = parseGooglePhotosUrl(block.url)
            if (!url) return null
            const cover =
              block.cover && typeof block.cover === 'object' ? (block.cover as Media) : null
            return (
              <a
                key={block.id}
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="group grid overflow-hidden rounded-xl border border-ivory/10 bg-charcoal transition-colors hover:border-gold/60 sm:grid-cols-[2fr_3fr]"
              >
                <div className="relative aspect-[4/3] bg-graphite">
                  {cover?.url ? (
                    <Image
                      src={cover.url}
                      alt={cover.alt}
                      fill
                      sizes="(min-width: 640px) 40vw, 100vw"
                      className="object-cover"
                    />
                  ) : (
                    <Images
                      aria-hidden="true"
                      className="absolute inset-0 m-auto size-12 text-mist"
                    />
                  )}
                </div>
                <div className="flex flex-col justify-center gap-3 p-6 sm:p-10">
                  <h2 className="font-display text-3xl">{block.title}</h2>
                  {block.description && <p className="text-mist">{block.description}</p>}
                  <span className="inline-flex items-center gap-2 text-sm text-gold group-hover:underline">
                    {t.viewOnGooglePhotos}
                    <ExternalLink aria-hidden="true" className="size-4" />
                  </span>
                </div>
              </a>
            )
          }

          case 'sharedAlbum':
            return <SharedAlbum key={block.id} block={block} locale={locale} tenant={tenant} />

          default:
            return null
        }
      })}
    </div>
  )
}
