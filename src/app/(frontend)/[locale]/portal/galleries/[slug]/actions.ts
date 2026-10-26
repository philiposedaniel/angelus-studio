'use server'

import config from '@payload-config'
import { revalidatePath } from 'next/cache'
import { getPayload } from 'payload'

import { getSessionUser } from '@/lib/auth'
import { submitSelection, type SubmitResult } from '@/lib/selectionSubmit'

/** The client submits the favorites they have chosen in one gallery as their selection. */
export async function submitGallerySelection(galleryId: number): Promise<SubmitResult | { status: 'forbidden' }> {
  const user = await getSessionUser()
  if (!user || !Number.isInteger(galleryId)) return { status: 'forbidden' }
  const result = await submitSelection({ payload: await getPayload({ config }), user, galleryId })
  if (result.status === 'submitted') revalidatePath('/[locale]/portal/galleries/[slug]', 'page')
  return result
}
