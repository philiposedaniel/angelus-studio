import type { Payload, PayloadRequest } from 'payload'

import { idOf } from '@/lib/ids'

/**
 * Opens the project for a quote whose deposit has been paid. Runs once per quote: if a project
 * already exists for it, nothing is created, so a repeated webhook changes nothing.
 */
export async function openProjectForQuote(
  payload: Payload,
  quote: { id: number; tenant?: unknown; title: string; clientName: string; clientEmail: string },
  req?: PayloadRequest,
) {
  const existing = await payload.find({
    collection: 'projects',
    where: { quote: { equals: quote.id } },
    limit: 1,
    depth: 0,
    overrideAccess: true,
    req,
  })
  if (existing.totalDocs > 0) return existing.docs[0]!

  const tenantId = idOf(quote.tenant)
  if (tenantId === undefined) throw new Error(`Quote ${quote.id} has no studio`)
  return payload.create({
    collection: 'projects',
    data: {
      tenant: Number(tenantId),
      title: quote.title,
      quote: quote.id,
      clientName: quote.clientName,
      clientEmail: quote.clientEmail,
      status: 'planning',
    },
    overrideAccess: true,
    req,
  })
}
