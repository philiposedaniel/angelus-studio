'use server'

import config from '@payload-config'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { getPayload } from 'payload'

import { isLocale } from '@/i18n/config'
import { tenantLocales } from '@/lib/locale'
import { requestOrigin } from '@/lib/requestOrigin'
import { getCurrentTenant } from '@/lib/tenant'
import { claimWaitlistPlaces, leaveWaitlist } from '@/lib/waitlist'

export type WaitlistActionState = { status: 'idle' } | { status: 'error'; reason: 'closed' | 'failed' }

/**
 * Takes the places offered to someone on the waitlist, with their link: a free ticket opens at
 * once, a paid one goes to Stripe Checkout. The studio comes from the host, never the form.
 */
export async function claimWaitlistAction(_previous: WaitlistActionState, form: FormData): Promise<WaitlistActionState> {
  const tenant = await getCurrentTenant()
  if (!tenant) return { status: 'error', reason: 'failed' }
  const result = await claimWaitlistPlaces({
    payload: await getPayload({ config }),
    tenantId: tenant.id,
    token: form.get('token'),
    origin: await requestOrigin(),
  })
  if (result.status === 'registered') {
    const requested = form.get('locale')
    const offered = tenantLocales(tenant)
    const locale = typeof requested === 'string' && isLocale(requested) && offered.includes(requested) ? requested : offered[0]!
    redirect(`/${locale}/tickets/${result.token}`)
  }
  if (result.status === 'checkout') redirect(result.url)
  revalidatePath('/[locale]/waitlist/[token]', 'page')
  return { status: 'error', reason: result.status === 'error' && result.reason === 'failed' ? 'failed' : 'closed' }
}

/** Takes someone off the waitlist with their own link. */
export async function leaveWaitlistAction(_previous: WaitlistActionState, form: FormData): Promise<WaitlistActionState> {
  const tenant = await getCurrentTenant()
  if (!tenant) return { status: 'error', reason: 'failed' }
  const left = await leaveWaitlist({ payload: await getPayload({ config }), tenantId: tenant.id, token: form.get('token') })
  revalidatePath('/[locale]/waitlist/[token]', 'page')
  return left ? { status: 'idle' } : { status: 'error', reason: 'closed' }
}
