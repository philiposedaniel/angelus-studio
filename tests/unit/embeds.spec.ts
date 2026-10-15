import { describe, expect, it } from 'vitest'

import { parseGooglePhotosUrl, parseVideoUrl } from '@/lib/embeds'

describe('parseVideoUrl', () => {
  it.each([
    ['https://vimeo.com/76979871', 'https://player.vimeo.com/video/76979871?dnt=1'],
    [
      'https://vimeo.com/76979871/a1b2c3d4e5',
      'https://player.vimeo.com/video/76979871?dnt=1&h=a1b2c3d4e5',
    ],
    [
      'https://player.vimeo.com/video/76979871?h=abc123',
      'https://player.vimeo.com/video/76979871?dnt=1&h=abc123',
    ],
    [
      'https://vimeo.com/channels/staffpicks/76979871',
      'https://player.vimeo.com/video/76979871?dnt=1',
    ],
    [
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10',
      'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
    ],
    ['https://youtu.be/dQw4w9WgXcQ', 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ'],
    [
      'https://www.youtube.com/shorts/dQw4w9WgXcQ',
      'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
    ],
    [
      'https://www.youtube.com/embed/dQw4w9WgXcQ',
      'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
    ],
  ])('accepts %s', (input, src) => {
    expect(parseVideoUrl(input)?.src).toBe(src)
  })

  it.each([
    'https://evil.example/vimeo.com/123',
    'https://vimeo.com.evil.example/123',
    'javascript:alert(1)',
    'https://www.youtube.com/watch?v=short',
    'https://vimeo.com/about',
    '',
  ])('rejects %s', (input) => {
    expect(parseVideoUrl(input)).toBeNull()
  })
})

describe('parseGooglePhotosUrl', () => {
  it('accepts shared album links', () => {
    expect(parseGooglePhotosUrl('https://photos.app.goo.gl/AbCdEf123')).toBe(
      'https://photos.app.goo.gl/AbCdEf123',
    )
    expect(parseGooglePhotosUrl('https://photos.google.com/share/AF1Qip?key=abc')).toBeTruthy()
  })

  it('rejects other links', () => {
    expect(parseGooglePhotosUrl('http://photos.app.goo.gl/AbCdEf123')).toBeNull()
    expect(parseGooglePhotosUrl('https://photos.google.com/')).toBeNull()
    expect(parseGooglePhotosUrl('https://example.com/photos.app.goo.gl/x')).toBeNull()
  })
})
