import { sql } from '@payloadcms/db-postgres'
import type { Payload, PayloadRequest } from 'payload'

import { getDictionary } from '@/i18n/dictionaries'
import { emailConfigured, fromStudio, renderEmail } from '@/lib/email'
import { idOf } from '@/lib/ids'
import { tenantLocales } from '@/lib/locale'
import { siteOrigin } from '@/lib/siteOrigin'
import { runSql } from '@/lib/sqlSession'
import type { User } from '@/payload-types'

export const GALLERY_NOTICE_TASK = 'send-gallery-notice'

/**
 * Queues the email that tells a gallery's clients it is ready. Queued in the same transaction as the
 * change that publishes the gallery, so a rolled-back change sends nothing. Does nothing when email
 * is not set up. Returns whether a job was queued.
 */
export async function queueGalleryNotice(req: PayloadRequest, galleryId: number) {
  if (!emailConfigured()) return false
  await req.payload.jobs.queue({ task: GALLERY_NOTICE_TASK, input: { id: galleryId }, req })
  return true
}

/**
 * Emails each client of a published gallery a link to it, once. Each client gets their own message, so no
 * one sees another client's address. The gallery is claimed first, in one statement, so two runs of the
 * job never both send. If every send fails, the claim is released and the job is retried. If some sends
 * went out, the claim stays, so a retry does not send to the clients who already have the link; the
 * clients whose send failed are counted in the result and the job log, and need a fresh publish to be
 * emailed again.
 */
export async function deliverGalleryNotice(
  payload: Payload,
  galleryId: number,
): Promise<{ sent: number; failed: number }> {
  const system = { overrideAccess: true } as const
  const gallery = await payload.findByID({ collection: 'galleries', id: galleryId, overrideAccess: true, depth: 1 }).catch(() => null)
  if (!gallery || gallery.status !== 'published' || !gallery.notifyClients) return { sent: 0, failed: 0 }

  const claimed = await runSql(
    payload,
    sql`UPDATE galleries SET clients_notified_at = now() WHERE id = ${galleryId}
      AND status = 'published' AND notify_clients = true AND clients_notified_at IS NULL RETURNING id`,
  )
  if (claimed.length !== 1) return { sent: 0, failed: 0 }

  const tenant = await payload.findByID({ collection: 'tenants', id: idOf(gallery.tenant)!, ...system, depth: 0 })
  const clients = ((gallery.clients ?? []) as (User | number)[]).filter((c): c is User => typeof c === 'object')
  // Clients get the studio's first language; accounts do not yet record a language of their own.
  const locale = tenantLocales(tenant)[0]!
  const localized = await payload.findByID({ collection: 'galleries', id: galleryId, locale, ...system, depth: 0 })
  const t = getDictionary(locale).emails.galleryReady
  const origin = await siteOrigin(payload, tenant.id)
  const url = `${origin}/${locale}/portal/galleries/${gallery.slug}`
  const title = localized.title ?? gallery.title

  let sent = 0
  let failed = 0
  for (const client of clients) {
    if (!client.email) continue
    const { text, html } = renderEmail(
      {
        to: client.email,
        subject: t.subject.replace('{gallery}', title),
        paragraphs: [t.body.replace('{studio}', tenant.name).replace('{gallery}', title)],
        action: { label: t.action, url },
        note: t.note,
      },
      tenant.name,
    )
    try {
      await payload.sendEmail({
        to: client.email,
        from: fromStudio(tenant.name),
        subject: t.subject.replace('{gallery}', title),
        text,
        html,
      })
      sent++
    } catch {
      failed++
    }
  }

  if (sent === 0 && failed > 0) {
    await runSql(payload, sql`UPDATE galleries SET clients_notified_at = NULL WHERE id = ${galleryId}`)
    throw new Error(`Gallery ${galleryId}: no client could be emailed; the job will be tried again.`)
  }
  if (failed > 0) payload.logger.error(`Gallery ${galleryId}: ${failed} client email(s) failed; not retried.`)
  return { sent, failed }
}
