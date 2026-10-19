import { PDFDocument, type PDFFont, StandardFonts } from 'pdf-lib'
import { beforeAll, describe, expect, it } from 'vitest'

import { pdfSafeText, renderInvoicePdf, wrapText, type InvoicePdfLabels } from '@/lib/invoicePdf'
import { invoiceTotals } from '@/lib/invoices'

const labels: InvoicePdfLabels = {
  title: 'Invoice',
  reference: 'Reference',
  billedTo: 'Billed to',
  item: 'Item',
  quantity: 'Quantity',
  price: 'Price',
  amount: 'Amount',
  total: 'Total',
  depositPaid: 'Deposit paid',
  balancePaid: 'Balance paid',
  amountDue: 'Amount due',
  paidInFull: 'Everything is paid. Thank you.',
  paymentsHeading: 'Payments received',
  noPayments: 'No payments have been received yet.',
  kindDeposit: 'Deposit',
  kindBalance: 'Balance',
  paidOn: 'paid',
}

const format = {
  money: (amount: number) => `€${(amount / 100).toFixed(2)}`,
  date: (iso: string) => iso.slice(0, 10),
}

const lineItems = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    description: `Item ${index + 1}: a long description that keeps going so the row wraps onto more than one line`,
    quantity: 1,
    unitAmount: 1000,
  }))

const quoteWith = (items: ReturnType<typeof lineItems>) => ({
  id: 7,
  title: 'Wedding',
  clientName: 'Maria Silva',
  lineItems: items,
})

describe('pdfSafeText', () => {
  it('keeps Western European letters and turns other characters into question marks', () => {
    expect(pdfSafeText('São Paulo, €5')).toBe('São Paulo, €5')
    expect(pdfSafeText('東京')).toBe('??')
    expect(pdfSafeText('Wedding — Silva & Costa “2026”')).toBe('Wedding — Silva & Costa “2026”')
  })

  it('flattens line breaks and tabs to spaces', () => {
    expect(pdfSafeText('one\ntwo\tthree')).toBe('one two three')
  })
})

describe('wrapText', () => {
  let font: PDFFont

  beforeAll(async () => {
    const pdf = await PDFDocument.create()
    font = await pdf.embedFont(StandardFonts.Helvetica)
  })

  it('keeps short text on one line', () => {
    expect(wrapText('Wedding photography', font, 10, 300)).toEqual(['Wedding photography'])
  })

  it('breaks long text so that no line is wider than the column', () => {
    const text = 'Coverage of the ceremony, the reception, the first dance and the family portraits afterwards'
    const lines = wrapText(text, font, 10, 120)
    expect(lines.length).toBeGreaterThan(1)
    for (const line of lines) expect(font.widthOfTextAtSize(line, 10)).toBeLessThanOrEqual(120)
    expect(lines.join(' ')).toBe(text)
  })

  it('splits a single word that is wider than the column', () => {
    const word = 'Supercalifragilisticexpialidocious'
    const lines = wrapText(word, font, 10, 60)
    for (const line of lines) expect(font.widthOfTextAtSize(line, 10)).toBeLessThanOrEqual(60)
    expect(lines.join('')).toBe(word)
  })

  it('returns one empty line for empty text, so a row still takes its height', () => {
    expect(wrapText('', font, 10, 300)).toEqual([''])
  })
})

describe('renderInvoicePdf', () => {
  it('makes a one-page PDF for a small invoice, with the totals worked out from the payments', async () => {
    const quote = { ...quoteWith(lineItems(1)), depositAmount: 300, totalAmount: 1000 }
    const payments = [{ kind: 'deposit', status: 'paid', amount: 300, paidAt: '2026-10-17T10:00:00.000Z' }]
    const totals = invoiceTotals(quote, payments)
    const bytes = await renderInvoicePdf({ quote, payments, totals }, labels, format)

    expect(Buffer.from(bytes.slice(0, 5)).toString('latin1')).toBe('%PDF-')
    const loaded = await PDFDocument.load(bytes)
    expect(loaded.getPageCount()).toBe(1)
    expect(loaded.getTitle()).toBe('Invoice #7')
    expect(totals.amountDue).toBe(700)
  })

  it('carries on to more pages when there are many line items', async () => {
    const items = lineItems(60)
    const quote = { ...quoteWith(items), depositAmount: 0, totalAmount: 60000 }
    const totals = invoiceTotals(quote, [])
    const bytes = await renderInvoicePdf({ quote, payments: [], totals }, labels, format)

    const loaded = await PDFDocument.load(bytes)
    expect(loaded.getPageCount()).toBeGreaterThan(1)
  })
})
