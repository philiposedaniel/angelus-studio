import type { Payload } from 'payload'
import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from 'pdf-lib'

import { getDictionary } from '@/i18n/dictionaries'
import { type InvoiceTotals, loadInvoice, type ScheduleLine, scheduleLines } from '@/lib/invoices'
import type { Locale } from '@/i18n/config'
import { formatMoney } from '@/lib/money'

/** Words the PDF prints, passed in from the interface dictionary so the document follows the studio's language. */
export type InvoicePdfLabels = {
  title: string
  reference: string
  billedTo: string
  item: string
  quantity: string
  price: string
  amount: string
  total: string
  depositPaid: string
  balancePaid: string
  amountDue: string
  paidInFull: string
  paymentsHeading: string
  noPayments: string
  kindDeposit: string
  kindBalance: string
  kindInstallment: string
  paidOn: string
  scheduleHeading: string
  scheduleDate: string
  scheduleDue: string
  schedulePaid: string
}

export type InvoicePdfInput = {
  quote: {
    id: number | string
    title: string
    clientName: string
    lineItems?: ReadonlyArray<{ description: string; quantity: number; unitAmount: number }> | null
  }
  payments: ReadonlyArray<{ kind?: string | null; installmentNumber?: number | null; amount: number; paidAt?: string | null }>
  totals: InvoiceTotals
  schedule?: readonly ScheduleLine[]
}

export type InvoicePdfFormat = {
  money: (amount: number) => string
  date: (iso: string) => string
}

const PAGE_WIDTH = 595.28 // A4
const PAGE_HEIGHT = 841.89
const MARGIN = 48
const LINE = 15
const TABLE = { description: MARGIN, quantityRight: 370, priceRight: 452, amountRight: PAGE_WIDTH - MARGIN }
const DESCRIPTION_WIDTH = 300
const INK = rgb(0.1, 0.1, 0.1)
const MUTED = rgb(0.4, 0.4, 0.4)

/**
 * The standard PDF fonts only cover Western European characters. Anything else is printed as '?',
 * so a name in another script never stops the document from being made.
 */
export function pdfSafeText(value: string): string {
  return value
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[^\x20-\x7E\xA0-\xFF€–—‘’“”•…]/g, '?')
}

/**
 * Breaks text into lines that fit the width. A single word too long for a line is split across lines.
 * `clean` makes the text drawable: the standard fonts' character set unless the font is embedded.
 */
export function wrapText(
  value: string,
  font: PDFFont,
  size: number,
  width: number,
  clean: (value: string) => string = pdfSafeText,
): string[] {
  const lines: string[] = []
  let current = ''
  for (const word of clean(value).split(' ').filter(Boolean)) {
    const candidate = current ? `${current} ${word}` : word
    if (font.widthOfTextAtSize(candidate, size) <= width) {
      current = candidate
      continue
    }
    if (current) lines.push(current)
    current = ''
    let rest = word
    while (font.widthOfTextAtSize(rest, size) > width && rest.length > 1) {
      let cut = rest.length - 1
      while (cut > 1 && font.widthOfTextAtSize(rest.slice(0, cut), size) > width) cut -= 1
      lines.push(rest.slice(0, cut))
      rest = rest.slice(cut)
    }
    current = rest
  }
  if (current || lines.length === 0) lines.push(current)
  return lines
}

/**
 * The invoice as a one-or-more page A4 PDF: the line items, totals, what has been paid and what is
 * still due. The text is the same as the invoice page. Built in memory; nothing is written to disk.
 */
export async function renderInvoicePdf(
  input: InvoicePdfInput,
  labels: InvoicePdfLabels,
  format: InvoicePdfFormat,
): Promise<Uint8Array> {
  const { quote, payments, totals, schedule } = input
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
  const kindLabel = (payment: { kind?: string | null; installmentNumber?: number | null }) =>
    payment.kind === 'deposit'
      ? labels.kindDeposit
      : payment.kind === 'balance'
        ? labels.kindBalance
        : payment.kind === 'installment'
          ? `${labels.kindInstallment} ${payment.installmentNumber ?? ''}`.trim()
          : ''

  // Heading
  newPageIfBelow(LINE * 4)
  write(labels.title, MARGIN, 20, bold)
  y -= LINE + 6
  write(`${labels.reference} #${quote.id}`, MARGIN, 10, regular, MUTED)
  y -= LINE
  write(quote.title, MARGIN, 13, bold)
  y -= LINE
  write(`${labels.billedTo}: ${quote.clientName}`, MARGIN, 10, regular, MUTED)
  y -= LINE * 1.5
  if (totals.amountDue === 0) {
    write(labels.paidInFull, MARGIN, 11, bold)
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
    [labels.total, format.money(totals.totalAmount), false],
    [labels.depositPaid, format.money(totals.depositPaid), false],
    [labels.balancePaid, format.money(totals.balancePaid), false],
    [labels.amountDue, format.money(totals.amountDue), true],
  ]
  for (const [label, value, strong] of totalRows) {
    newPageIfBelow(LINE)
    write(label, 330, 10, strong ? bold : regular)
    writeRight(value, TABLE.amountRight, 10, strong ? bold : regular)
    y -= LINE
  }
  y -= LINE

  // Payment schedule: each installment, when it is due and whether it has been paid
  if ((schedule ?? []).length > 0) {
    newPageIfBelow(LINE * ((schedule ?? []).length + 3))
    write(labels.scheduleHeading, MARGIN, 12, bold)
    y -= LINE + 2
    write(labels.kindInstallment, MARGIN, 10, bold, MUTED)
    write(labels.scheduleDate, TABLE.quantityRight - 40, 10, bold, MUTED)
    write(labels.schedulePaid, TABLE.priceRight, 10, bold, MUTED)
    writeRight(labels.amount, TABLE.amountRight, 10, bold, MUTED)
    rule(y - 4)
    y -= LINE
    y -= 4
    for (const line of schedule ?? []) {
      newPageIfBelow(LINE)
      write(`${labels.kindInstallment} ${line.number}`, MARGIN, 10, regular)
      if (line.dueDate) write(format.date(line.dueDate), TABLE.quantityRight - 40, 10, regular)
      if (line.paidAt) write(format.date(line.paidAt), TABLE.priceRight, 10, regular)
      else write(labels.scheduleDue, TABLE.priceRight, 10, regular, MUTED)
      writeRight(format.money(line.amount), TABLE.amountRight, 10, regular)
      y -= LINE
    }
    y -= LINE
  }

  // Payments
  newPageIfBelow(LINE * 2)
  write(labels.paymentsHeading, MARGIN, 12, bold)
  y -= LINE + 2
  if (payments.length === 0) {
    newPageIfBelow(LINE)
    write(labels.noPayments, MARGIN, 10, regular, MUTED)
    y -= LINE
  }
  for (const payment of payments) {
    newPageIfBelow(LINE)
    const when = payment.paidAt ? ` · ${labels.paidOn} ${format.date(payment.paidAt)}` : ''
    write(`${kindLabel(payment)}${when}`, MARGIN, 10, regular)
    writeRight(format.money(payment.amount), TABLE.amountRight, 10, regular)
    y -= LINE
  }

  return pdf.save()
}

/**
 * The invoice PDF for a quote's private link, or null when the link finds no invoice (wrong studio,
 * unknown token, or a quote that is still a draft). The lookup is the same one the invoice page uses.
 */
export async function loadInvoicePdf(
  payload: Payload,
  tenantId: number,
  token: string,
  locale: Locale,
): Promise<{ filename: string; bytes: Uint8Array } | null> {
  const invoice = await loadInvoice(payload, tenantId, token)
  if (!invoice) return null
  const labels = getDictionary(locale).invoice
  const currency = invoice.quote.currency
  const bytes = await renderInvoicePdf({ ...invoice, schedule: scheduleLines(invoice.quote.paymentSchedule, invoice.payments) }, labels, {
    money: (amount) => formatMoney(amount, currency, locale),
    date: (iso) => new Date(iso).toLocaleDateString(locale, { dateStyle: 'long', timeZone: 'UTC' }),
  })
  return { filename: `invoice-${invoice.quote.id}.pdf`, bytes }
}
