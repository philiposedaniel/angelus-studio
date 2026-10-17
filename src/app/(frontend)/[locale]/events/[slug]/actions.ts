'use server'

import config from '@payload-config'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { getPayload } from 'payload'

import { isLocale } from '@/i18n/config'
import { clientAddress } from '@/lib/inquiries'
import { tenantLocales } from '@/lib/locale'
import { requestOrigin } from '@/lib/requestOrigin'
import { getCurrentTenant } from '@/lib/tenant'
import { submitRegistration, type RegistrationState } from '@/lib/tickets'
import { joinWaitlist, type WaitlistJoinState } from '@/lib/waitlist'

/** The visitor's language, if this studio offers it. */
function chosenLocale(tenant: NonNullable<Awaited<ReturnType<typeof getCurrentTenant>>>, form: FormData) {
  const requested = form.get('locale')
  const offered = tenantLocales(tenant)
  return typeof requested === 'string' && isLocale(requested) && offered.includes(requested) ? requested : offered[0]!
}

/**
 * Registers from the event page. A free ticket opens at once; a paid one goes to Stripe Checkout
 * first. The studio comes from the host, never the form.
 */
export async function register(_previous: RegistrationState, form: FormData): Promise<RegistrationState> {
  const tenant = await getCurrentTenant()
  if (!tenant) return { status: 'error', reason: 'failed' }
  const locale = chosenLocale(tenant, form)
  const eventId = Number(form.get('event'))
  if (!Number.isInteger(eventId) || eventId < 1) return { status: 'error', reason: 'closed' }

  const result = await submitRegistration({
    payload: await getPayload({ config }),
    tenantId: tenant.id,
    eventId,
    locale,
    form,
    address: clientAddress(await headers()),
    origin: await requestOrigin(),
  })
  if (result.status === 'registered') redirect(`/${locale}/tickets/${result.token}`)
  if (result.status === 'checkout') redirect(result.url)
  return result
}

/** Joins a sold-out ticket's waitlist from the event page, then opens the person's waitlist link. */
export async function joinWaitlistAction(_previous: WaitlistJoinState, form: FormData): Promise<WaitlistJoinState> {
  const tenant = await getCurrentTenant()
  if (!tenant) return { status: 'error', reason: 'failed' }
  const locale = chosenLocale(tenant, form)
  const eventId = Number(form.get('event'))
  if (!Number.isInteger(eventId) || eventId < 1) return { status: 'error', reason: 'closed' }

  const result = await joinWaitlist({
    payload: await getPayload({ config }),
    tenantId: tenant.id,
    eventId,
    locale,
    form,
    address: clientAddress(await headers()),
  })
  if (result.status === 'joined') redirect(`/${locale}/waitlist/${result.token}`)
  return result
}
