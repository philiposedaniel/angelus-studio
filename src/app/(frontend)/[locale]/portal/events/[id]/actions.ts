'use server'

import config from '@payload-config'
import { revalidatePath } from 'next/cache'
import { getPayload } from 'payload'

import { getSessionUser } from '@/lib/auth'
import { tenantLocales } from '@/lib/locale'
import { saveGuestFromPortal, type GuestFormState } from '@/lib/organizerGuests'
import { getCurrentTenant } from '@/lib/tenant'

/** Adds, changes or removes a guest from the organizer's portal, as the signed-in user. */
export async function saveGuest(_previous: GuestFormState, form: FormData): Promise<GuestFormState> {
  const tenant = await getCurrentTenant()
  const user = await getSessionUser()
  if (!tenant || !user) return { status: 'error', reason: 'forbidden' }
  const result = await saveGuestFromPortal({
    payload: await getPayload({ config }),
    user,
    form,
    offeredLanguages: tenantLocales(tenant),
  })
  if (result.status === 'saved') revalidatePath('/[locale]/portal/events/[id]', 'page')
  return result
}
