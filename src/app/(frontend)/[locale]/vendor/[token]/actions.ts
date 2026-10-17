'use server'

import config from '@payload-config'
import { revalidatePath } from 'next/cache'
import { getPayload } from 'payload'

import { getCurrentTenant } from '@/lib/tenant'
import { confirmVendorBooking, type ConfirmState } from '@/lib/vendors'

/** A vendor confirms their booking. The studio comes from the host; the booking from its token. */
export async function confirmBooking(_previous: ConfirmState, form: FormData): Promise<ConfirmState> {
  const tenant = await getCurrentTenant()
  if (!tenant) return { status: 'error', reason: 'failed' }
  const result = await confirmVendorBooking({ payload: await getPayload({ config }), tenantId: tenant.id, form })
  if (result.status === 'confirmed') revalidatePath('/[locale]/vendor/[token]', 'page')
  return result
}
