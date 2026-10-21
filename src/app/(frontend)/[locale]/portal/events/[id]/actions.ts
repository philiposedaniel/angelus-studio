'use server'

import config from '@payload-config'
import { revalidatePath } from 'next/cache'
import { getPayload } from 'payload'

import { getSessionUser } from '@/lib/auth'
import { tenantLocales } from '@/lib/locale'
import {
  importGuestsFromPortal,
  saveGuestFromPortal,
  type GuestFormState,
  type GuestImportState,
} from '@/lib/organizerGuests'
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

/** Checks a guest list spreadsheet, or adds its guests, from the organizer's portal, as the signed-in user. */
export async function importGuests(_previous: GuestImportState, form: FormData): Promise<GuestImportState> {
  const tenant = await getCurrentTenant()
  const user = await getSessionUser()
  if (!tenant || !user) return { status: 'error', reason: 'forbidden' }
  const result = await importGuestsFromPortal({ payload: await getPayload({ config }), user, form })
  if (result.status === 'added') revalidatePath('/[locale]/portal/events/[id]', 'page')
  return result
}
