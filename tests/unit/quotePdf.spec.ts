import { inflateSync } from 'node:zlib'

import { PDFDocument } from 'pdf-lib'
import { describe, expect, it } from 'vitest'

import { type QuotePdfLabels, renderQuotePdf } from '@/lib/quotePdf'

const labels: QuotePdfLabels = {
  title: 'Quote',
  reference: 'Reference',
  preparedFor: 'Prepared for',
  validUntil: 'Valid until',
  item: 'Item',
  quantity: 'Quantity',
  price: 'Price',
  amount: 'Amount',
  total: 'Total',
  deposit: 'Deposit due now',
  balance: 'Balance after the deposit',
  contractHeading: 'Contract',
  signedBy: 'Signed by',
  installmentName: 'Installment',
  scheduleHeading: 'Payment schedule',
  scheduleDate: 'Due date',
}

const format = {
  money: (amount: number) => `€${(amount / 100).toFixed(2)}`,
  date: (iso: string) => iso.slice(0, 10),
}

const quote = {
  id: 7,
  title: 'Summer wedding',
  clientName: 'Maria Silva',
  validUntil: '2026-12-01T00:00:00.000Z',
  totalAmount: 250000,
  depositAmount: 75000,
  lineItems: [{ description: 'Wedding photography, full day', quantity: 1, unitAmount: 250000 }],
}

/**
 * The text drawn on the pages. pdf-lib compresses each content stream and writes the text as hex
 * strings, so inflate the streams and decode every string shown with Tj.
 */
const drawnText = (bytes: Uint8Array) =>
  [...Buffer.from(bytes).toString('latin1').matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)]
    .map((match) => {
      try {
        return inflateSync(Buffer.from(match[1]!, 'latin1')).toString('latin1')
      } catch {
        return ''
      }
    })
    .flatMap((content) => [...content.matchAll(/<([0-9A-F]*)> Tj/g)].map((hex) => Buffer.from(hex[1]!, 'hex').toString('latin1')))
    .join('\n')

const pageCount = async (bytes: Uint8Array) => (await PDFDocument.load(bytes)).getPageCount()

describe('quote PDF', () => {
  it('makes a one-page A4 PDF for a quote without contract terms', async () => {
    const bytes = await renderQuotePdf({ quote }, labels, format)
    expect(Buffer.from(bytes.slice(0, 5)).toString('latin1')).toBe('%PDF-')
    expect(await pageCount(bytes)).toBe(1)
  })

  it('prints the contract terms and the signature when the client has signed', async () => {
    const terms = Array.from({ length: 120 }, (_, index) => `Clause ${index + 1}: the studio delivers the gallery.`).join('\n')
    const signed = await renderQuotePdf(
      {
        quote: {
          ...quote,
          contract: { terms, signedName: 'Maria Silva', signedAt: '2026-10-19T10:00:00.000Z' },
        },
      },
      labels,
      format,
    )
    expect(await pageCount(signed)).toBeGreaterThan(1)
  })

  it('keeps unsupported characters from stopping the document', async () => {
    const bytes = await renderQuotePdf(
      { quote: { ...quote, clientName: '李小龍', title: 'Boda — Marta & Juan' } },
      labels,
      format,
    )
    expect(Buffer.from(bytes.slice(0, 5)).toString('latin1')).toBe('%PDF-')
  })

  it('lists each instalment with its due date and amount when the balance is paid in instalments', async () => {
    const bytes = await renderQuotePdf(
      {
        quote: {
          ...quote,
          paymentSchedule: [
            { dueDate: '2026-11-15T00:00:00.000Z', amount: 90000 },
            { dueDate: '2026-12-15T00:00:00.000Z', amount: 90000 },
          ],
        },
      },
      labels,
      format,
    )
    const text = drawnText(bytes)
    expect(text).toContain('2026-11-15')
    expect(text).toContain('2026-12-15')
    expect(text).toContain('Payment schedule')
    expect(await pageCount(bytes)).toBe(1)
  })
})
