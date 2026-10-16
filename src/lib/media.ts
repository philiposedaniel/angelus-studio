/**
 * Payload returns media URLs as absolute addresses when the site's server URL is set. next/image
 * only loads paths on this site (see `images.localPatterns` in next.config.ts), so the server's own
 * origin is taken off. Any other address is returned unchanged.
 */
export function mediaSrc(url: string): string {
  const server = process.env.NEXT_PUBLIC_SERVER_URL
  if (!server) return url
  try {
    const target = new URL(url)
    return target.origin === new URL(server).origin ? `${target.pathname}${target.search}` : url
  } catch {
    // A relative path, or a value that is not a URL: already usable as it is.
    return url
  }
}
