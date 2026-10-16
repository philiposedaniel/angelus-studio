import config from '@payload-config'
import { notFound } from 'next/navigation'
import { getPayload } from 'payload'

import { PaymentButton } from '@/components/quote/PaymentButton'
import { getDictionary } from '@/i18n/dictionaries'
import { resolveLocale } from '@/lib/locale'
import { formatMoney } from '@/lib/money'
import { balanceAmount, isQuoteExpired } from '@/lib/quotes'
import { stripeConfigured } from '@/lib/stripe'
import { isShareToken } from '@/lib/shareTokens'
import { getCurrentTenant } from '@/lib/tenant'

// The link carries the quote's secret: keep it out of search engines.
export const metadata = { robots: { index: false } }

const formatDate = (value: string, locale: string) =>
  new Date(value).toLocaleDateString(locale, { dateStyle: 'long', timeZone: 'UTC' })

/** A priced quote a client opens from a private link. Shows the deposit and takes payment for it. */
export default async function QuotePage({ params, searchParams }: PageProps<'/[locale]/quote/[token]'>) {
  const tenant = await getCurrentTenant()
  if (!tenant) notFound()
  const { locale: requested, token } = await params
  const locale = await resolveLocale(tenant, requested)
  if (!isShareToken(token)) notFound()

  const payload = await getPayload({ config })
  // Public access: the link's token and the studio of this site are the only keys.
  const { docs } = await payload.find({
    collection: 'quotes',
    where: {
      and: [
        { tenant: { equals: tenant.id } },
        { publicToken: { equals: token } },
        { status: { in: ['sent', 'deposit-paid', 'paid-in-full'] } },
      ],
    },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })
  const quote = docs[0]
  if (!quote) notFound()

  const t = getDictionary(locale).quote
  const query = await searchParams
  const money = (amount: number) => formatMoney(amount, quote.currency, locale)
  const depositDue = quote.status === 'sent'
  const expired = depositDue && isQuoteExpired(quote.validUntil)
  const balance = balanceAmount(quote)
  const balanceDue = quote.status === 'deposit-paid' && balance > 0
  const canPayDeposit = depositDue && !expired && stripeConfigured()
  const canPayBalance = balanceDue && stripeConfigured()

  return (
    <main className="mx-auto grid max-w-3xl gap-8 px-6 py-16 text-ivory">
      <header className="grid gap-2">
        <h1 className="font-serif text-4xl">{quote.title}</h1>
        <p className="text-mist">
          {t.preparedFor}: {quote.clientName}
        </p>
        {quote.validUntil && (
          <p className="text-mist">
            {t.validUntil}: {formatDate(quote.validUntil, locale)}
          </p>
        )}
      </header>

      {query.payment === 'success' && <p role="status" className="text-gold">{t.paymentConfirming}</p>}
      {query.payment === 'cancelled' && <p role="status" className="text-mist">{t.paymentCancelled}</p>}
      {quote.status === 'deposit-paid' && <p role="status" className="text-gold">{t.paid}</p>}
      {quote.status === 'paid-in-full' && <p role="status" className="text-gold">{t.paidInFull}</p>}
      {expired && <p className="text-copper">{t.expired}</p>}

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
          <dd>{money(quote.totalAmount ?? 0)}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-mist">{t.deposit}</dt>
          <dd className="text-gold">{money(quote.depositAmount ?? 0)}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-mist">{t.balance}</dt>
          <dd>{money(balance)}</dd>
        </div>
      </dl>

      {canPayDeposit && <PaymentButton kind="deposit" token={token} locale={locale} t={t} />}
      {canPayBalance && <PaymentButton kind="balance" token={token} locale={locale} t={t} />}
      {((depositDue && !expired) || balanceDue) && !stripeConfigured() && (
        <p className="text-mist">{t.paymentUnavailable}</p>
      )}
    </main>
  )
}
