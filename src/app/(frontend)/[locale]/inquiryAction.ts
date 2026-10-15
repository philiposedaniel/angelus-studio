'use server'

import config from '@payload-config'
import { headers } from 'next/headers'
import { getPayload } from 'payload'

import { isLocale } from '@/i18n/config'
import { clientAddress, submitInquiry, type InquiryState } from '@/lib/inquiries'
import { tenantLocales } from '@/lib/locale'
import { getCurrentTenant } from '@/lib/tenant'

/** The website contact form's server action. The studio comes from the host, never the form. */
export async function sendInquiry(_previous: InquiryState, form: FormData): Promise<InquiryState> {
  const tenant = await getCurrentTenant()
  if (!tenant) return { status: 'error', reason: 'failed' }
  const requested = form.get('locale')
  const locale =
    typeof requested === 'string' &&
    isLocale(requested) &&
    tenantLocales(tenant).includes(requested)
      ? requested
      : tenantLocales(tenant)[0]!
  return submitInquiry({
    payload: await getPayload({ config }),
    tenantId: tenant.id,
    locale,
    form,
    address: clientAddress(await headers()),
  })
}
