import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { mediaSrc } from '@/lib/media'

const original = process.env.NEXT_PUBLIC_SERVER_URL

describe('media URLs for next/image', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SERVER_URL = 'https://studio.example'
  })

  afterEach(() => {
    if (original === undefined) delete process.env.NEXT_PUBLIC_SERVER_URL
    else process.env.NEXT_PUBLIC_SERVER_URL = original
  })

  it('takes the site’s own origin off an absolute media URL', () => {
    expect(mediaSrc('https://studio.example/api/media/file/hero.jpg')).toBe('/api/media/file/hero.jpg')
    expect(mediaSrc('https://studio.example/api/media/file/hero-card.jpg?v=2')).toBe(
      '/api/media/file/hero-card.jpg?v=2',
    )
  })

  it('leaves other hosts and relative paths alone', () => {
    expect(mediaSrc('https://cdn.other.example/api/media/file/hero.jpg')).toBe(
      'https://cdn.other.example/api/media/file/hero.jpg',
    )
    expect(mediaSrc('/api/media/file/hero.jpg')).toBe('/api/media/file/hero.jpg')
    expect(mediaSrc('not a url')).toBe('not a url')
  })

  it('returns the URL unchanged when no server URL is set', () => {
    delete process.env.NEXT_PUBLIC_SERVER_URL
    expect(mediaSrc('https://studio.example/api/media/file/hero.jpg')).toBe(
      'https://studio.example/api/media/file/hero.jpg',
    )
  })
})
