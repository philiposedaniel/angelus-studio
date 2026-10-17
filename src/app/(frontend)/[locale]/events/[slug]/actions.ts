'use server'

import config from '@payload-config'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { getPayload } from 'payload'

import { isLocale } from '@/i18n/config'
import { clientAddress } from '@/lib/inquiries'
import { tenantLocales } from '@/lib/locale'
import { getCurrentTenant } from '@/lib/tenant'
import { submitRegistration, type RegistrationState } from '@/lib/tickets'

/** Registers for a free ticket from the event page, then opens the new ticket. The studio comes from the host. */
export async function register(_previous: RegistrationState, form: FormData): Promise<RegistrationState> {
  const tenant = await getCurrentTenant()
  if (!tenant) return { status: 'error', reason: 'failed' }
  const requested = form.get('locale')
  const offered = tenantLocales(tenant)
  const locale = typeof requested === 'string' && isLocale(requested) && offered.includes(requested) ? requested : offered[0]!
  const eventId = Number(form.get('event'))
  if (!Number.isInteger(eventId) || eventId < 1) return { status: 'error', reason: 'closed' }

  const result = await submitRegistration({
    payload: await getPayload({ config }),
    tenantId: tenant.id,
    eventId,
    locale,
    form,
    address: clientAddress(await headers()),
  })
  if (result.status === 'registered') redirect(`/${locale}/tickets/${result.token}`)
  return result
}
