import sharp from 'sharp'

/** Text is written in a box this share of the photo's shorter side, so it reads the same at any size. */
const TEXT_SHARE = 0.035

const escapeXml = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/**
 * Writes `text` in the bottom-right corner of a preview copy. Used on the viewing copies
 * clients see, never on originals. Returns WebP, the format of those copies.
 */
export async function watermarkImage(input: Buffer, text: string): Promise<Buffer> {
  const image = sharp(input)
  const { width = 1, height = 1 } = await image.metadata()
  const size = Math.max(12, Math.round(Math.min(width, height) * TEXT_SHARE))
  const margin = Math.round(size * 0.6)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <text x="${width - margin}" y="${height - margin}" text-anchor="end" font-family="sans-serif"
      font-size="${size}" font-weight="600" fill="#ffffff" fill-opacity="0.6"
      stroke="#000000" stroke-opacity="0.35" stroke-width="${Math.max(1, Math.round(size / 12))}"
      paint-order="stroke">${escapeXml(text)}</text>
  </svg>`
  return image
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .webp({ quality: 85 })
    .toBuffer()
}
