/**
 * Turns links staff paste into the admin into safe embed addresses. Only known hosts are
 * accepted; anything else is rejected at save time rather than rendered.
 */

export type VideoEmbed = { provider: 'vimeo' | 'youtube'; id: string; src: string }

const parse = (value: string): URL | null => {
  try {
    const url = new URL(value.trim())
    return url.protocol === 'https:' || url.protocol === 'http:' ? url : null
  } catch {
    return null
  }
}

const hostIs = (url: URL, ...hosts: string[]) =>
  hosts.some((host) => url.hostname === host || url.hostname === `www.${host}`)

const YOUTUBE_ID = /^[\w-]{11}$/

/** Vimeo (public, unlisted with a hash, or player links) and YouTube (watch, short, shorts, embed). */
export function parseVideoUrl(value: string | null | undefined): VideoEmbed | null {
  const url = value ? parse(value) : null
  if (!url) return null
  const parts = url.pathname.split('/').filter(Boolean)

  if (hostIs(url, 'vimeo.com', 'player.vimeo.com')) {
    // vimeo.com/123, vimeo.com/123/abcdef (unlisted), vimeo.com/channels/x/123, player.vimeo.com/video/123?h=abc
    const index = parts.findIndex((part) => /^\d+$/.test(part))
    if (index === -1) return null
    const id = parts[index]!
    const hash =
      url.searchParams.get('h') ??
      (/^[0-9a-f]+$/i.test(parts[index + 1] ?? '') ? parts[index + 1] : null)
    const query = new URLSearchParams({ dnt: '1', ...(hash ? { h: hash } : {}) })
    return { provider: 'vimeo', id, src: `https://player.vimeo.com/video/${id}?${query}` }
  }

  let youtubeId: string | null = null
  if (hostIs(url, 'youtu.be')) youtubeId = parts[0] ?? null
  else if (hostIs(url, 'youtube.com', 'm.youtube.com', 'youtube-nocookie.com')) {
    youtubeId =
      url.pathname === '/watch'
        ? url.searchParams.get('v')
        : ['embed', 'shorts', 'live'].includes(parts[0] ?? '')
          ? (parts[1] ?? null)
          : null
  }
  if (youtubeId && YOUTUBE_ID.test(youtubeId)) {
    return {
      provider: 'youtube',
      id: youtubeId,
      src: `https://www.youtube-nocookie.com/embed/${youtubeId}`,
    }
  }
  return null
}

/** Google Photos shared album links: photos.app.goo.gl/… or photos.google.com/share/… */
export function parseGooglePhotosUrl(value: string | null | undefined): string | null {
  const url = value ? parse(value) : null
  if (!url || url.protocol !== 'https:') return null
  const parts = url.pathname.split('/').filter(Boolean)
  if (url.hostname === 'photos.app.goo.gl' && parts.length === 1) return url.toString()
  if (
    url.hostname === 'photos.google.com' &&
    ['share', 'album'].includes(parts[0] ?? '') &&
    parts[1]
  ) {
    return url.toString()
  }
  return null
}

/** The page loaded inside the sandboxed frame for pasted embed code. */
export const embedDocument = (code: string) =>
  `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;background:transparent}iframe,video,img{max-width:100%}</style></head><body>${code}</body></html>`
