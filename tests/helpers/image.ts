import sharp from 'sharp'

/** A small generated JPEG for upload tests, so no binary fixtures live in the repo. */
export async function testJpeg(name: string) {
  const data = await sharp({
    create: { width: 2400, height: 1600, channels: 3, background: { r: 180, g: 140, b: 90 } },
  })
    .jpeg()
    .toBuffer()
  return { data, mimetype: 'image/jpeg', name, size: data.length }
}
