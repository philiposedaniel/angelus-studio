import { readFile } from 'node:fs/promises'
import path from 'node:path'

import fontkit from '@pdf-lib/fontkit'
import type { PDFDocument, PDFFont } from 'pdf-lib'

/**
 * Liberation Sans, embedded so guests' names print in their own letters: it covers Latin with every
 * European accent (Ł, Ő, Ş, Ž…), Greek and Cyrillic, at the same widths as Helvetica. The files and
 * their licence (SIL OFL 1.1) are in src/assets/fonts; next.config.ts ships them with the server.
 */
const FONT_DIR = path.join(process.cwd(), 'src', 'assets', 'fonts')

let files: Promise<[Buffer, Buffer]> | null = null
const fontFiles = () =>
  (files ??= Promise.all([
    readFile(path.join(FONT_DIR, 'LiberationSans-Regular.ttf')),
    readFile(path.join(FONT_DIR, 'LiberationSans-Bold.ttf')),
  ]).catch((error: unknown) => {
    files = null
    throw error
  }))

/** Embeds the regular and bold faces, keeping only the letters the document uses. */
export async function embedTextFonts(pdf: PDFDocument): Promise<{ regular: PDFFont; bold: PDFFont }> {
  pdf.registerFontkit(fontkit)
  const [regular, bold] = await fontFiles()
  return {
    regular: await pdf.embedFont(regular, { subset: true }),
    bold: await pdf.embedFont(bold, { subset: true }),
  }
}

const characterSets = new WeakMap<PDFFont, Set<number>>()

/**
 * Text the font can draw: line breaks and tabs become spaces, and a letter the font does not have
 * (Chinese, Arabic, emoji) becomes '?', so a name in another script never stops the document.
 */
export function fontSafeText(font: PDFFont, value: string): string {
  let set = characterSets.get(font)
  if (!set) {
    set = new Set(font.getCharacterSet())
    characterSets.set(font, set)
  }
  const known = set
  return Array.from(value.replace(/[\r\n\t]+/g, ' '), (char) => (known.has(char.codePointAt(0)!) ? char : '?')).join('')
}
