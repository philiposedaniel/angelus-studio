import type { UIFieldServerProps } from 'payload'

import { getDictionary } from '@/i18n/dictionaries'
import { clientSummary } from '@/lib/clientSummary'
import { formatMoney } from '@/lib/money'

const link: React.CSSProperties = { textDecoration: 'underline' }

/** A client's quotes and productions, read with the signed-in staff member's own access. */
export async function ClientSummaryField(props: UIFieldServerProps) {
  const t = getDictionary('en').clientSummary
  const box: React.CSSProperties = { display: 'grid', gap: 8, marginBottom: 24 }
  if (props.id === undefined || typeof props.data?.email !== 'string') {
    return (
      <div style={box}>
        <strong>{t.heading}</strong>
        <p style={{ margin: 0 }}>{t.saveFirst}</p>
      </div>
    )
  }
  const summary = await clientSummary(props.payload, props.req, { id: props.id, email: props.data.email })

  return (
    <div style={box}>
      <strong>{t.heading}</strong>
      <p style={{ margin: 0, fontSize: 12, opacity: 0.75 }}>{t.note}</p>

      <span style={{ fontWeight: 600 }}>{t.quotes}</span>
      {summary.quotes.length === 0 ? (
        <p style={{ margin: 0 }}>{t.noQuotes}</p>
      ) : (
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          {summary.quotes.map((quote) => (
            <li key={quote.id}>
              <a href={`/admin/collections/quotes/${quote.id}`} style={link}>
                {quote.title}
              </a>{' '}
              · {quote.status} · {t.total} {formatMoney(quote.totalAmount, quote.currency, 'en')}
            </li>
          ))}
        </ul>
      )}

      <span style={{ fontWeight: 600 }}>{t.productions}</span>
      {summary.productions.length === 0 ? (
        <p style={{ margin: 0 }}>{t.noProductions}</p>
      ) : (
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          {summary.productions.map((project) => (
            <li key={project.id}>
              <a href={`/admin/collections/projects/${project.id}`} style={link}>
                {project.title}
              </a>{' '}
              · {project.status}
              {project.shootDate ? ` · ${t.shootDate} ${project.shootDate.slice(0, 10)}` : ''}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
