import config from '@payload-config'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getPayload } from 'payload'

import { getDictionary } from '@/i18n/dictionaries'
import { loadInvoice } from '@/lib/invoices'
import { resolveLocale } from '@/lib/locale'
import { formatMoney } from '@/lib/money'
import { isShareToken } from '@/lib/shareTokens'
import { getCurrentTenant } from '@/lib/tenant'

// The link carries the quote's secret: keep it out of search engines.
export const metadata = { robots: { index: false } }

const formatDate = (value: string, locale: string) =>
  new Date(value).toLocaleDateString(locale, { dateStyle: 'long', timeZone: 'UTC' })

/** The invoice for a quote the client was sent: what was agreed, what has been paid, and what is still due. */
export default async function InvoicePage({ params }: PageProps<'/[locale]/quote/[token]/invoice'>) {
  const tenant = await getCurrentTenant()
  if (!tenant) notFound()
  const { locale: requested, token } = await params
  const locale = await resolveLocale(tenant, requested)
  if (!isShareToken(token)) notFound()

  const payload = await getPayload({ config })
  // Public access: the link's token and the studio of this site are the only keys.
  const invoice = await loadInvoice(payload, tenant.id, token)
  if (!invoice) notFound()
  const { quote, payments, totals } = invoice

  const t = getDictionary(locale).invoice
  const money = (amount: number) => formatMoney(amount, quote.currency, locale)
  const kindLabel = (kind: string | null | undefined) =>
    kind === 'deposit' ? t.kindDeposit : kind === 'balance' ? t.kindBalance : ''

  return (
    <main className="mx-auto grid max-w-3xl gap-8 px-6 py-16 text-ivory">
      <header className="grid gap-2">
        <p className="text-mist">
          {t.reference} #{quote.id}
        </p>
        <h1 className="font-serif text-4xl">{quote.title}</h1>
        <p className="text-mist">
          {t.billedTo}: {quote.clientName}
        </p>
      </header>

      {totals.amountDue === 0 && <p role="status" className="text-gold">{t.paidInFull}</p>}

      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-ivory/15 text-mist">
            <th className="py-2 font-normal">{t.item}</th>
            <th className="py-2 text-right font-normal">{t.quantity}</th>
            <th className="py-2 text-right font-normal">{t.price}</th>
            <th className="py-2 text-right font-normal">{t.amount}</th>
          </tr>
        </thead>
        <tbody>
          {quote.lineItems?.map((item) => (
            <tr key={item.id ?? item.description} className="border-b border-ivory/10">
              <td className="py-3">{item.description}</td>
              <td className="py-3 text-right">{item.quantity}</td>
              <td className="py-3 text-right">{money(item.unitAmount)}</td>
              <td className="py-3 text-right">{money(item.quantity * item.unitAmount)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <dl className="grid gap-2 sm:ml-auto sm:w-80">
        <div className="flex justify-between">
          <dt className="text-mist">{t.total}</dt>
          <dd>{money(totals.totalAmount)}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-mist">{t.depositPaid}</dt>
          <dd>{money(totals.depositPaid)}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-mist">{t.balancePaid}</dt>
          <dd>{money(totals.balancePaid)}</dd>
        </div>
        <div className="flex justify-between border-t border-ivory/15 pt-2 font-medium">
          <dt>{t.amountDue}</dt>
          <dd className="text-gold">{money(totals.amountDue)}</dd>
        </div>
      </dl>

      <section className="grid gap-3">
        <h2 className="font-serif text-2xl">{t.paymentsHeading}</h2>
        {payments.length === 0 ? (
          <p className="text-mist">{t.noPayments}</p>
        ) : (
          <ul className="grid gap-2">
            {payments.map((payment) => (
              <li key={payment.id} className="flex justify-between border-b border-ivory/10 py-2">
                <span>
                  {kindLabel(payment.kind)}
                  {payment.paidAt ? ` · ${t.paidOn} ${formatDate(payment.paidAt, locale)}` : ''}
                </span>
                <span>{money(payment.amount)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Link href={`/${locale}/quote/${token}`} className="text-gold underline underline-offset-4">
        {t.backToQuote}
      </Link>
    </main>
  )
}
