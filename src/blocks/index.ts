import type { Block } from 'payload'

import { parseGooglePhotosUrl, parseVideoUrl } from '@/lib/embeds'

const ASPECTS = [
  { label: 'Widescreen 16:9', value: '16/9' },
  { label: 'Classic 4:3', value: '4/3' },
  { label: 'Square 1:1', value: '1/1' },
  { label: 'Vertical 9:16', value: '9/16' },
  { label: 'Cinema 21:9', value: '21/9' },
]

const caption = { name: 'caption', type: 'text', localized: true } as const

export const TextBlock: Block = {
  slug: 'text',
  labels: { singular: 'Text', plural: 'Text' },
  fields: [{ name: 'content', type: 'richText', required: true, localized: true }],
}

export const VideoBlock: Block = {
  slug: 'video',
  labels: { singular: 'Video (Vimeo or YouTube)', plural: 'Videos' },
  fields: [
    {
      name: 'url',
      type: 'text',
      required: true,
      admin: { description: 'Paste the Vimeo or YouTube link. Unlisted Vimeo links work too.' },
      validate: (value: string | null | undefined) =>
        Boolean(parseVideoUrl(value)) || 'Use a Vimeo or YouTube video link.',
    },
    { name: 'aspect', type: 'select', defaultValue: '16/9', required: true, options: ASPECTS },
    caption,
  ],
}

export const EmbedCodeBlock: Block = {
  slug: 'embedCode',
  labels: { singular: 'Embed code', plural: 'Embed codes' },
  fields: [
    {
      name: 'code',
      type: 'code',
      required: true,
      maxLength: 20_000,
      admin: {
        language: 'html',
        description:
          'Paste the embed code from any video or media service. It runs in an isolated frame, so it cannot read visitors’ sessions or change the rest of the page.',
      },
    },
    {
      name: 'title',
      type: 'text',
      required: true,
      localized: true,
      admin: { description: 'What the embed shows, for screen readers.' },
    },
    {
      name: 'size',
      type: 'select',
      defaultValue: '16/9',
      required: true,
      options: [...ASPECTS, { label: 'Fixed height', value: 'fixed' }],
    },
    {
      name: 'height',
      type: 'number',
      defaultValue: 480,
      min: 100,
      max: 2000,
      admin: { condition: (_, block) => block?.size === 'fixed', description: 'Height in pixels.' },
    },
    caption,
  ],
}

export const GooglePhotosBlock: Block = {
  slug: 'googlePhotos',
  labels: { singular: 'Google Photos album', plural: 'Google Photos albums' },
  fields: [
    {
      name: 'url',
      type: 'text',
      required: true,
      admin: {
        description:
          'The album’s share link (photos.app.goo.gl/…). Google does not allow its albums inside other websites, so this shows a card that opens the album.',
      },
      validate: (value: string | null | undefined) =>
        Boolean(parseGooglePhotosUrl(value)) || 'Use a Google Photos shared album link.',
    },
    { name: 'title', type: 'text', required: true, localized: true },
    { name: 'description', type: 'textarea', localized: true },
    {
      name: 'cover',
      type: 'upload',
      relationTo: 'media',
      admin: { description: 'A photo from the album.' },
    },
  ],
}

export const SharedAlbumBlock: Block = {
  slug: 'sharedAlbum',
  labels: { singular: 'Photo album (from a gallery)', plural: 'Photo albums' },
  fields: [
    {
      name: 'gallery',
      type: 'relationship',
      relationTo: 'galleries',
      required: true,
      // Only galleries already shared by link are public, so only those are offered.
      filterOptions: { shareEnabled: { equals: true } },
      admin: {
        description: 'Only galleries with “Share by link” turned on can be shown on the website.',
      },
    },
    caption,
  ],
}

export const PAGE_BLOCKS = [
  TextBlock,
  VideoBlock,
  EmbedCodeBlock,
  GooglePhotosBlock,
  SharedAlbumBlock,
]
