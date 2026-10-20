import config from '@payload-config'
import { notFound } from 'next/navigation'
import { getPayload } from 'payload'

import { calendarResponse, publicEventCalendar } from '@/lib/eventCalendar'
import { resolveLocale } from '@/lib/locale'
import { getCurrentTenant } from '@/lib/tenant'

/** A published event on this studio's site as a calendar file. */
export async function GET(_request: Request, { params }: { params: Promise<{ locale: string; slug: string }> }) {
  const tenant = await getCurrentTenant()
  if (!tenant) notFound()
  const { locale: requested, slug } = await params
  const locale = await resolveLocale(tenant, requested)
  const payload = await getPayload({ config })
  return calendarResponse(await publicEventCalendar(payload, tenant.id, slug, locale))
}
