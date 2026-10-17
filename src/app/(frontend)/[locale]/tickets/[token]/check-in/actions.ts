'use server'

import config from '@payload-config'
import { revalidatePath } from 'next/cache'
import { getPayload } from 'payload'

import { getSessionUser } from '@/lib/auth'
import type { CheckInState } from '@/lib/checkIn'
import { getCurrentTenant } from '@/lib/tenant'
import { checkInTicket } from '@/lib/tickets'

/** Checks a ticket in at the door. Only the studio's guest-list staff may; the server checks again. */
export async function checkInTicketAction(_previous: CheckInState, form: FormData): Promise<CheckInState> {
  const tenant = await getCurrentTenant()
  if (!tenant) return { status: 'error', reason: 'failed' }
  const result = await checkInTicket({
    payload: await getPayload({ config }),
    user: await getSessionUser(),
    tenantId: tenant.id,
    form,
  })
  if (result.status === 'saved') revalidatePath('/[locale]/tickets/[token]', 'layout')
  return result
}
