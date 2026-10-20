import config from '@payload-config'
import { notFound } from 'next/navigation'
import { getPayload } from 'payload'

import { calendarResponse, invitationCalendar } from '@/lib/eventCalendar'
import { resolveLocale } from '@/lib/locale'
import { getCurrentTenant } from '@/lib/tenant'

/** The event behind this private link as a calendar file. The link's token is the only key. */
export async function GET(_request: Request, { params }: { params: Promise<{ locale: string; token: string }> }) {
  const tenant = await getCurrentTenant()
  if (!tenant) notFound()
  const { locale: requested, token } = await params
  const locale = await resolveLocale(tenant, requested)
  const payload = await getPayload({ config })
  return calendarResponse(await invitationCalendar(payload, tenant.id, token, locale))
}
