'use server'

import config from '@payload-config'
import { revalidatePath } from 'next/cache'
import { getPayload } from 'payload'

import { submitRsvp, type RsvpState } from '@/lib/rsvp'
import { getCurrentTenant } from '@/lib/tenant'

/** Saves a guest's RSVP. The studio comes from the host; the invitation from its token. */
export async function sendRsvp(_previous: RsvpState, form: FormData): Promise<RsvpState> {
  const tenant = await getCurrentTenant()
  if (!tenant) return { status: 'error', reason: 'failed' }
  const result = await submitRsvp({ payload: await getPayload({ config }), tenantId: tenant.id, form })
  if (result.status === 'saved') revalidatePath('/[locale]/invite/[token]', 'page')
  return result
}
