import config from '@payload-config'
import { getPayload } from 'payload'

import { loadInvoicePdf } from '@/lib/invoicePdf'
import { resolveLocale } from '@/lib/locale'
import { isShareToken } from '@/lib/shareTokens'
import { getCurrentTenant } from '@/lib/tenant'

const notFound = () => new Response('Not found', { status: 404 })

/**
 * The invoice as a PDF, for the same private link as the invoice page. The link's token and the
 * studio are both required, as on the page. Drafts and other quote statuses have no invoice.
 */
export async function GET(_request: Request, { params }: RouteContext<'/[locale]/quote/[token]/invoice/pdf'>) {
  const tenant = await getCurrentTenant()
  if (!tenant) return notFound()
  const { locale: requested, token } = await params
  const locale = await resolveLocale(tenant, requested)
  if (!isShareToken(token)) return notFound()

  const payload = await getPayload({ config })
  const file = await loadInvoicePdf(payload, tenant.id, token, locale)
  if (!file) return notFound()

  return new Response(new Uint8Array(file.bytes), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${file.filename}"`,
      'Content-Length': String(file.bytes.length),
      // The file carries the client's details: keep it out of shared caches and search engines.
      'Cache-Control': 'private, no-store',
      'X-Robots-Tag': 'noindex',
    },
  })
}
