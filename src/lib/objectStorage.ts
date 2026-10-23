import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import type { Readable } from 'stream'

/**
 * Private object storage for client files, on any S3-compatible service (Cloudflare R2, Amazon S3,
 * MinIO). It is on when S3_BUCKET is set; without it, files stay on the local volume.
 *
 * Objects are never public. A download is served only after the app has checked access, and then
 * as a signed link that lasts `SIGNED_URL_SECONDS`.
 */

export const SIGNED_URL_SECONDS = 300

export const objectStorageEnabled = (env: Record<string, string | undefined> = process.env) => Boolean(env.S3_BUCKET)

export type ObjectStore = {
  put(key: string, body: Buffer, contentType: string): Promise<void>
  /** A readable stream of the object. Throws when the object is missing. */
  get(key: string): Promise<Readable>
  /** Deletes an object. Deleting a missing object is not an error. */
  delete(key: string): Promise<void>
  /**
   * A link that opens the object for `expiresInSeconds`, then stops working. With `downloadName`, the
   * browser is asked to save the file under that name instead of showing it.
   */
  signedUrl(key: string, expiresInSeconds: number, options?: { downloadName?: string }): Promise<string>
}

/**
 * A Content-Disposition value that makes a browser save the file as `name`. Browsers ignore the
 * `download` attribute on a link to another origin, so a link that redirects to the bucket has to ask
 * for the download in the signed link itself.
 */
export function attachmentDisposition(name: string): string {
  const fallback = name.replace(/[^\x20-\x7e]|["\\]/g, '_')
  const encoded = encodeURIComponent(name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`
}

export type S3Settings = {
  bucket: string
  region: string
  endpoint?: string
  forcePathStyle: boolean
  accessKeyId: string
  secretAccessKey: string
}

/** The S3 settings from the environment. Throws when S3_BUCKET is set but the rest is not, so a half-set
 * configuration fails loudly instead of quietly keeping files on the local disk. */
export function s3Settings(env: Record<string, string | undefined> = process.env): S3Settings {
  const bucket = env.S3_BUCKET
  if (!bucket) throw new Error('S3_BUCKET is not set')
  const missing = ['S3_REGION', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'].filter((name) => !env[name])
  if (missing.length) throw new Error(`S3_BUCKET is set but ${missing.join(', ')} ${missing.length > 1 ? 'are' : 'is'} not`)
  return {
    bucket,
    region: env.S3_REGION!,
    endpoint: env.S3_ENDPOINT || undefined,
    forcePathStyle: env.S3_FORCE_PATH_STYLE === 'true',
    accessKeyId: env.S3_ACCESS_KEY_ID!,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY!,
  }
}

/** An object store on an S3-compatible service. Exported so signing can be tested without a bucket. */
export function createS3Store(settings: S3Settings): ObjectStore {
  const client = new S3Client({
    region: settings.region,
    endpoint: settings.endpoint,
    forcePathStyle: settings.forcePathStyle,
    credentials: { accessKeyId: settings.accessKeyId, secretAccessKey: settings.secretAccessKey },
  })
  const Bucket = settings.bucket
  return {
    async put(key, body, contentType) {
      await client.send(new PutObjectCommand({ Bucket, Key: key, Body: body, ContentType: contentType }))
    },
    async get(key) {
      const object = await client.send(new GetObjectCommand({ Bucket, Key: key }))
      // In Node.js the response body is a readable stream.
      return object.Body as Readable
    },
    async delete(key) {
      await client.send(new DeleteObjectCommand({ Bucket, Key: key }))
    },
    signedUrl(key, expiresInSeconds, options) {
      const ResponseContentDisposition = options?.downloadName ? attachmentDisposition(options.downloadName) : undefined
      return getSignedUrl(client, new GetObjectCommand({ Bucket, Key: key, ResponseContentDisposition }), {
        expiresIn: expiresInSeconds,
      })
    },
  }
}

let override: ObjectStore | null = null
let shared: ObjectStore | null = null

/**
 * Test seam: replaces the S3 store with an in-memory one, so routes and jobs can run without a bucket.
 * Pass null to restore the real store.
 */
export function setObjectStore(store: ObjectStore | null) {
  override = store
}

/** The store that holds client files. Throws when object storage is not enabled. */
export function objectStore(): ObjectStore {
  if (override) return override
  if (!shared) shared = createS3Store(s3Settings())
  return shared
}
