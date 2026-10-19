import config from '@payload-config'
import { getPayload } from 'payload'

import { loadQuotePdf } from '@/lib/quotePdf'
import { resolveLocale } from '@/lib/locale'
import { isShareToken } from '@/lib/shareTokens'
import { getCurrentTenant } from '@/lib/tenant'

const notFound = () => new Response('Not found', { status: 404 })

/**
 * The quote as a PDF, for the same private link as the quote page. The link's token and the studio
 * are both required, as on the page. Drafts have no public quote.
 */
export async function GET(_request: Request, { params }: RouteContext<'/[locale]/quote/[token]/pdf'>) {
  const tenant = await getCurrentTenant()
  if (!tenant) return notFound()
  const { locale: requested, token } = await params
  const locale = await resolveLocale(tenant, requested)
  if (!isShareToken(token)) return notFound()

  const payload = await getPayload({ config })
  const file = await loadQuotePdf(payload, tenant.id, token, locale)
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
