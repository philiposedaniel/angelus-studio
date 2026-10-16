import sharp from 'sharp'
import { describe, expect, it } from 'vitest'

import { watermarkImage } from '@/lib/watermark'

const photo = () =>
  sharp({ create: { width: 800, height: 600, channels: 3, background: { r: 120, g: 120, b: 120 } } })
    .jpeg()
    .toBuffer()

describe('watermarkImage', () => {
  it('writes WebP at the same size, and the marked bytes differ from the original', async () => {
    const original = await photo()
    const marked = await watermarkImage(original, 'Angelus Media')
    const meta = await sharp(marked).metadata()
    expect(meta.format).toBe('webp')
    expect(meta.width).toBe(800)
    expect(meta.height).toBe(600)
    expect(marked.equals(original)).toBe(false)
  })

  it('draws the text in the bottom-right corner only', async () => {
    const plain = await sharp(await photo()).webp().toBuffer()
    const marked = await watermarkImage(await photo(), 'Angelus Media')
    const { data: a } = await sharp(plain).raw().toBuffer({ resolveWithObject: true })
    const { data: b } = await sharp(marked).raw().toBuffer({ resolveWithObject: true })
    const width = 800
    const changed = (x0: number, x1: number, y0: number, y1: number) => {
      for (let y = y0; y < y1; y++)
        for (let x = x0; x < x1; x++) {
          const i = (y * width + x) * 3
          if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) return true
        }
      return false
    }
    expect(changed(560, 800, 480, 600)).toBe(true)
    expect(changed(0, 240, 0, 120)).toBe(false)
  })

  it('takes text containing markup characters without breaking', async () => {
    await expect(watermarkImage(await photo(), 'Smith & <Jones> "2026"')).resolves.toBeInstanceOf(Buffer)
  })
})
