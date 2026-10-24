'use server'

import config from '@payload-config'
import { revalidatePath } from 'next/cache'
import { getPayload } from 'payload'

import { getCurrentTenant } from '@/lib/tenant'
import { cancelTicket } from '@/lib/tickets'

export type CancelTicketState = { status: 'idle' } | { status: 'error'; reason: 'closed' | 'failed' }

/** Cancels a free registration with its own ticket link. The studio comes from the host, never the form. */
export async function cancelTicketAction(_previous: CancelTicketState, form: FormData): Promise<CancelTicketState> {
  const tenant = await getCurrentTenant()
  if (!tenant) return { status: 'error', reason: 'failed' }
  const result = await cancelTicket({ payload: await getPayload({ config }), tenantId: tenant.id, token: form.get('token') })
  revalidatePath('/[locale]/tickets/[token]', 'page')
  return result.status === 'cancelled' ? { status: 'idle' } : result
}
