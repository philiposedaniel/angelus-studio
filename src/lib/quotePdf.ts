import type { Payload } from 'payload'
import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from 'pdf-lib'

import type { Locale } from '@/i18n/config'
import { getDictionary } from '@/i18n/dictionaries'
import { contractRequired, contractSigned } from '@/lib/contracts'
import { pdfSafeText, wrapText } from '@/lib/invoicePdf'
import { formatMoney } from '@/lib/money'

/** Words the quote PDF prints, from the interface dictionary so the document follows the studio's language. */
export type QuotePdfLabels = {
  title: string
  reference: string
  preparedFor: string
  validUntil: string
  item: string
  quantity: string
  price: string
  amount: string
  total: string
  deposit: string
  balance: string
  contractHeading: string
  signedBy: string
  installmentName: string
  scheduleHeading: string
  scheduleDate: string
}

export type QuotePdfInput = {
  quote: {
    id: number | string
    title: string
    clientName: string
    validUntil?: string | null
    totalAmount?: number | null
    depositAmount?: number | null
    lineItems?: ReadonlyArray<{ description: string; quantity: number; unitAmount: number }> | null
    paymentSchedule?: ReadonlyArray<{ dueDate?: string | null; amount?: number | null }> | null
    contract?: {
      terms?: string | null
      signedName?: string | null
      signedAt?: string | null
    } | null
  }
}

export type QuotePdfFormat = {
  money: (amount: number) => string
  date: (iso: string) => string
}

const PAGE_WIDTH = 595.28 // A4
const PAGE_HEIGHT = 841.89
const MARGIN = 48
const LINE = 15
const TABLE = {
  description: MARGIN,
  quantityRight: 370,
  priceRight: 452,
  amountRight: PAGE_WIDTH - MARGIN,
  schedule: { date: 300 },
}
const DESCRIPTION_WIDTH = 300
const TEXT_WIDTH = PAGE_WIDTH - 2 * MARGIN
const INK = rgb(0.1, 0.1, 0.1)
const MUTED = rgb(0.4, 0.4, 0.4)

/**
 * The quote statuses a client can open: the same ones the quote page shows. A draft has no public
 * PDF, so its link finds nothing.
 */
const PUBLIC_QUOTE_STATUSES = ['sent', 'deposit-paid', 'paid-in-full'] as const

/**
 * The quote as a one-or-more page A4 PDF: the line items, the total, the deposit due now, the balance
 * after it and, when the quote carries contract terms, the terms and the client's signature.
 * Built in memory; nothing is written to disk.
 */
export async function renderQuotePdf(input: QuotePdfInput, labels: QuotePdfLabels, format: QuotePdfFormat) {
  const { quote } = input
  const total = quote.totalAmount ?? 0
  const deposit = quote.depositAmount ?? 0
  const pdf = await PDFDocument.create()
  pdf.setTitle(pdfSafeText(`${labels.title} #${quote.id}`))
  const regular = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)

  let page: PDFPage = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT])
  let y = PAGE_HEIGHT - MARGIN

  const newPageIfBelow = (height: number) => {
    if (y - height >= MARGIN) return
    page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT])
    y = PAGE_HEIGHT - MARGIN
  }
  const write = (value: string, x: number, size: number, font: PDFFont, color = INK) => {
    page.drawText(pdfSafeText(value), { x, y, size, font, color })
  }
  const writeRight = (value: string, right: number, size: number, font: PDFFont, color = INK) => {
    const text = pdfSafeText(value)
    page.drawText(text, { x: right - font.widthOfTextAtSize(text, size), y, size, font, color })
  }
  const rule = (at: number) => {
    page.drawLine({
      start: { x: MARGIN, y: at },
      end: { x: PAGE_WIDTH - MARGIN, y: at },
      thickness: 0.6,
      color: MUTED,
    })
  }

  // Heading
  newPageIfBelow(LINE * 4)
  write(labels.title, MARGIN, 20, bold)
  y -= LINE + 6
  write(`${labels.reference} #${quote.id}`, MARGIN, 10, regular, MUTED)
  y -= LINE
  write(quote.title, MARGIN, 13, bold)
  y -= LINE
  write(`${labels.preparedFor}: ${quote.clientName}`, MARGIN, 10, regular, MUTED)
  y -= LINE
  if (quote.validUntil) {
    write(`${labels.validUntil}: ${format.date(quote.validUntil)}`, MARGIN, 10, regular, MUTED)
    y -= LINE
  }
  y -= LINE

  // Line items
  newPageIfBelow(LINE * 2)
  write(labels.item, TABLE.description, 10, bold, MUTED)
  writeRight(labels.quantity, TABLE.quantityRight, 10, bold, MUTED)
  writeRight(labels.price, TABLE.priceRight, 10, bold, MUTED)
  writeRight(labels.amount, TABLE.amountRight, 10, bold, MUTED)
  rule(y - 4)
  y -= LINE
  y -= 4
  for (const item of quote.lineItems ?? []) {
    const lines = wrapText(item.description, regular, 10, DESCRIPTION_WIDTH)
    newPageIfBelow(LINE * lines.length + 4)
    for (const [index, text] of lines.entries()) {
      write(text, TABLE.description, 10, regular)
      if (index === 0) {
        writeRight(String(item.quantity), TABLE.quantityRight, 10, regular)
        writeRight(format.money(item.unitAmount), TABLE.priceRight, 10, regular)
        writeRight(format.money(item.quantity * item.unitAmount), TABLE.amountRight, 10, regular)
      }
      y -= LINE
    }
    y -= 4
  }
  rule(y + 4)
  y -= LINE

  // Totals
  const totalRows: Array<[string, string, boolean]> = [
    [labels.total, format.money(total), false],
    [labels.deposit, format.money(deposit), true],
    [labels.balance, format.money(total - deposit), false],
  ]
  for (const [label, value, strong] of totalRows) {
    newPageIfBelow(LINE)
    write(label, 330, 10, strong ? bold : regular)
    writeRight(value, TABLE.amountRight, 10, strong ? bold : regular)
    y -= LINE
  }
  y -= LINE

  // Payment schedule: each installment with its due date, when the balance is paid in instalments
  const schedule = quote.paymentSchedule ?? []
  if (schedule.length > 0) {
    newPageIfBelow(LINE * (schedule.length + 3))
    write(labels.scheduleHeading, MARGIN, 12, bold)
    y -= LINE + 2
    write(labels.installmentName, MARGIN, 10, bold, MUTED)
    write(labels.scheduleDate, TABLE.schedule.date, 10, bold, MUTED)
    writeRight(labels.amount, TABLE.amountRight, 10, bold, MUTED)
    rule(y - 4)
    y -= LINE
    y -= 4
    for (const [index, row] of schedule.entries()) {
      newPageIfBelow(LINE)
      write(`${labels.installmentName} ${index + 1}`, MARGIN, 10, regular)
      if (row.dueDate) write(format.date(row.dueDate), TABLE.schedule.date, 10, regular)
      writeRight(format.money(row.amount ?? 0), TABLE.amountRight, 10, regular)
      y -= LINE
    }
    y -= LINE
  }

  // Contract terms, one paragraph at a time, and the client's signature when there is one
  const terms = quote.contract?.terms ?? ''
  if (contractRequired(quote.contract)) {
    newPageIfBelow(LINE * 2)
    write(labels.contractHeading, MARGIN, 12, bold)
    y -= LINE + 2
    for (const paragraph of terms.split(/\r?\n/)) {
      const lines = paragraph.trim() ? wrapText(paragraph, regular, 10, TEXT_WIDTH) : ['']
      for (const text of lines) {
        newPageIfBelow(LINE)
        if (text) write(text, MARGIN, 10, regular)
        y -= LINE
      }
    }
    y -= LINE / 2
    if (contractSigned(quote.contract) && quote.contract?.signedAt) {
      newPageIfBelow(LINE)
      const name = quote.contract.signedName ?? ''
      write(`${labels.signedBy} ${name} · ${format.date(quote.contract.signedAt)}`, MARGIN, 10, bold)
      y -= LINE
    }
  }

  return pdf.save()
}

/**
 * The quote PDF for a quote's private link, or null when the link finds no quote (wrong studio,
 * unknown token, or a draft). The lookup and statuses match the quote page.
 */
export async function loadQuotePdf(
  payload: Payload,
  tenantId: number,
  token: string,
  locale: Locale,
): Promise<{ filename: string; bytes: Uint8Array } | null> {
  // Public access: the link's token and the studio are the only keys, as on the quote page.
  const { docs } = await payload.find({
    collection: 'quotes',
    where: {
      and: [
        { tenant: { equals: tenantId } },
        { publicToken: { equals: token } },
        { status: { in: [...PUBLIC_QUOTE_STATUSES] } },
      ],
    },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })
  const quote = docs[0]
  if (!quote) return null

  const labels = getDictionary(locale).quote
  const bytes = await renderQuotePdf({ quote }, labels, {
    money: (amount) => formatMoney(amount, quote.currency, locale),
    date: (iso) => new Date(iso).toLocaleDateString(locale, { dateStyle: 'long', timeZone: 'UTC' }),
  })
  return { filename: `quote-${quote.id}.pdf`, bytes }
}
