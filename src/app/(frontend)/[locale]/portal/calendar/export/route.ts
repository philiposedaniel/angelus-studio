import config from '@payload-config'
import { notFound } from 'next/navigation'
import { getPayload } from 'payload'

import { getPortalUser } from '@/lib/auth'
import { productionsBetween, twelveMonthBounds, parseMonth } from '@/lib/calendar'
import { resolveLocale } from '@/lib/locale'
import { buildProductionCalendar } from '@/lib/ics'
import { getCurrentTenant } from '@/lib/tenant'

/**
 * The productions the signed-in member can see, from this month for the next twelve months, as an
 * iCalendar file. Signed-out visitors get 401. The file holds only the calendar fields.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ locale: string }> }) {
  const tenant = await getCurrentTenant()
  if (!tenant) notFound()
  const locale = await resolveLocale(tenant, (await params).locale)
  const user = await getPortalUser(tenant)
  if (!user) return new Response('Sign in to download your calendar.', { status: 401 })

  const payload = await getPayload({ config })
  const productions = await productionsBetween(
    payload,
    user,
    tenant,
    twelveMonthBounds(parseMonth(undefined)),
  )
  const host = tenant.domain ?? 'angelus-studio.invalid'
  const body = buildProductionCalendar({
    productions,
    calendarName: tenant.name,
    host,
  })
  return new Response(body, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="productions-${locale}.ics"`,
      'Cache-Control': 'private, no-store',
    },
  })
}
