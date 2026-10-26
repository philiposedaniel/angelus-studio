import { inflateSync } from 'node:zlib'

import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, PDFRef } from 'pdf-lib'

const streamText = (stream: PDFRawStream) => {
  const filter = stream.dict.get(PDFName.of('Filter'))
  const bytes = Buffer.from(stream.getContents())
  return (filter ? inflateSync(bytes) : bytes).toString('latin1')
}

/** A font's glyph-to-text map, read from its ToUnicode CMap. */
const toUnicode = (doc: PDFDocument, font: PDFDict) => {
  const map = new Map<string, string>()
  const ref = font.get(PDFName.of('ToUnicode'))
  const stream = ref instanceof PDFRef ? doc.context.lookup(ref) : undefined
  if (!(stream instanceof PDFRawStream)) return map
  for (const [, code, unicode] of streamText(stream).matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
    const units = unicode!.match(/.{4}/g)!.map((unit) => parseInt(unit, 16))
    map.set(code!.toUpperCase(), String.fromCharCode(...units))
  }
  return map
}

/**
 * The text a PDF draws, one line per text-showing operator, decoded through each embedded font's
 * ToUnicode map so letters outside Latin-1 read back as written.
 */
export async function pdfText(bytes: Uint8Array): Promise<string> {
  const doc = await PDFDocument.load(bytes)
  const lines: string[] = []
  for (const page of doc.getPages()) {
    const fonts = new Map<string, Map<string, string>>()
    const fontDict = page.node.Resources()?.lookup(PDFName.of('Font'), PDFDict)
    for (const [name, ref] of fontDict?.entries() ?? []) {
      fonts.set(name.asString().slice(1), toUnicode(doc, doc.context.lookup(ref, PDFDict)))
    }
    const contents = page.node.Contents()
    const streams = contents instanceof PDFArray ? contents.asArray().map((ref) => doc.context.lookup(ref)) : [contents]
    let current = new Map<string, string>()
    for (const stream of streams) {
      if (!(stream instanceof PDFRawStream)) continue
      for (const [, font, hex] of streamText(stream).matchAll(/\/(\S+) [\d.]+ Tf|<([0-9A-Fa-f]*)> Tj/g)) {
        if (font) current = fonts.get(font) ?? new Map()
        else lines.push((hex!.toUpperCase().match(/.{4}/g) ?? []).map((code) => current.get(code) ?? '?').join(''))
      }
    }
  }
  return lines.join('\n')
}
