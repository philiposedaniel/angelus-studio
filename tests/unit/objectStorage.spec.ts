import { describe, expect, it } from 'vitest'

import { createS3Store, objectStorageEnabled, s3Settings, SIGNED_URL_SECONDS } from '@/lib/objectStorage'

const complete = {
  S3_BUCKET: 'studio-private',
  S3_REGION: 'auto',
  S3_ENDPOINT: 'https://account.example.test',
  S3_ACCESS_KEY_ID: 'AKIATESTONLY',
  S3_SECRET_ACCESS_KEY: 'test-secret-not-real',
}

describe('object storage settings', () => {
  it('is off when no bucket is set, so files stay on the local volume', () => {
    expect(objectStorageEnabled({} as NodeJS.ProcessEnv)).toBe(false)
  })

  it('reads a complete configuration', () => {
    expect(s3Settings(complete)).toEqual({
      bucket: 'studio-private',
      region: 'auto',
      endpoint: 'https://account.example.test',
      forcePathStyle: false,
      accessKeyId: 'AKIATESTONLY',
      secretAccessKey: 'test-secret-not-real',
    })
  })

  it('refuses a bucket without its keys or region, instead of keeping files locally', () => {
    expect(() => s3Settings({ S3_BUCKET: 'studio-private' })).toThrow(
      'S3_REGION, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY are not',
    )
    expect(() => s3Settings({ ...complete, S3_SECRET_ACCESS_KEY: '' })).toThrow('S3_SECRET_ACCESS_KEY is not')
  })

  it('turns path style on only for the exact value true', () => {
    expect(s3Settings({ ...complete, S3_FORCE_PATH_STYLE: 'true' }).forcePathStyle).toBe(true)
    expect(s3Settings({ ...complete, S3_FORCE_PATH_STYLE: 'yes' }).forcePathStyle).toBe(false)
  })
})

describe('signed download links', () => {
  const store = createS3Store(s3Settings(complete))

  it('expire after the short lifetime, and name the object', async () => {
    const url = new URL(await store.signedUrl('gallery-photos/frame-001.jpg', SIGNED_URL_SECONDS))
    expect(url.hostname).toBe('studio-private.account.example.test')
    expect(url.pathname).toBe('/gallery-photos/frame-001.jpg')
    expect(url.searchParams.get('X-Amz-Expires')).toBe(String(SIGNED_URL_SECONDS))
    expect(url.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/)
  })

  it('puts the bucket in the path when path style is on', async () => {
    const pathStyle = createS3Store(s3Settings({ ...complete, S3_FORCE_PATH_STYLE: 'true' }))
    const url = new URL(await pathStyle.signedUrl('gallery-photos/frame-001.jpg', SIGNED_URL_SECONDS))
    expect(url.hostname).toBe('account.example.test')
    expect(url.pathname).toBe('/studio-private/gallery-photos/frame-001.jpg')
  })

  it('never puts the secret key in the link', async () => {
    const link = await store.signedUrl('gallery-photos/frame-001.jpg', SIGNED_URL_SECONDS)
    expect(link).not.toContain('test-secret-not-real')
  })

  it('signs each object on its own, so one link does not open another file', async () => {
    const a = new URL(await store.signedUrl('gallery-photos/a.jpg', SIGNED_URL_SECONDS))
    const b = new URL(await store.signedUrl('gallery-photos/b.jpg', SIGNED_URL_SECONDS))
    expect(a.searchParams.get('X-Amz-Signature')).not.toBe(b.searchParams.get('X-Amz-Signature'))
  })
})
