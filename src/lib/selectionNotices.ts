import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'

import { GALLERY_STAFF_ROLES } from '@/access/galleries'
import { tenantIdsWithRole } from '@/access/roles'
import { getDictionary } from '@/i18n/dictionaries'
import { emailConfigured, fromStudio, renderEmail } from '@/lib/email'
import { idOf } from '@/lib/ids'
import { tenantLocales } from '@/lib/locale'
import { siteOrigin } from '@/lib/siteOrigin'
import { runSql } from '@/lib/sqlSession'
import type { User } from '@/payload-types'

export const SELECTION_NOTICE_TASK = 'send-selection-notice'

/**
 * Queues the email that tells the studio's gallery staff a client has submitted a selection. Called after
 * the submission is saved, so a failed save sends nothing. Does nothing when email is not set up.
 */
export async function queueSelectionNotice(payload: Payload, selectionId: number) {
  if (!emailConfigured()) return false
  await payload.jobs.queue({ task: SELECTION_NOTICE_TASK, input: { id: selectionId } })
  return true
}

/**
 * Emails each member of the gallery's studio who can manage galleries a link to review the selection.
 * Each person gets their own message. The submission is claimed first, in one statement, by recording
 * which submission was announced, so two runs of the job never both send and a later resubmission is
 * announced again. If every send fails, the claim is released and the job is retried. If some sends went
 * out, the claim stays and the failed ones are only counted in the job log.
 */
export async function deliverSelectionNotice(
  payload: Payload,
  selectionId: number,
): Promise<{ sent: number; failed: number }> {
  const system = { overrideAccess: true } as const
  const selection = await payload
    .findByID({ collection: 'gallery-selections', id: selectionId, ...system, depth: 0 })
    .catch(() => null)
  if (!selection || selection.status !== 'submitted' || !selection.submittedAt) return { sent: 0, failed: 0 }

  const claimed = await runSql(
    payload,
    sql`UPDATE gallery_selections SET staff_notice_for = submitted_at WHERE id = ${selectionId}
      AND status = 'submitted' AND submitted_at IS NOT NULL AND staff_notice_for IS DISTINCT FROM submitted_at
      RETURNING id`,
  )
  if (claimed.length !== 1) return { sent: 0, failed: 0 }

  const tenantId = idOf(selection.tenant)!
  const tenant = await payload.findByID({ collection: 'tenants', id: tenantId, ...system, depth: 0 })
  const gallery = await payload.findByID({ collection: 'galleries', id: idOf(selection.gallery)!, ...system, depth: 0 })
  const client = await payload.findByID({ collection: 'users', id: idOf(selection.user)!, ...system, depth: 0 })

  // Only people who can manage this studio's galleries, not every account that belongs to it.
  const { docs: members } = await payload.find({
    collection: 'users',
    where: { 'tenants.tenant': { equals: tenantId } },
    pagination: false,
    depth: 0,
    ...system,
  })
  const staff = members.filter(
    (member: User) =>
      Boolean(member.email) &&
      tenantIdsWithRole(member, GALLERY_STAFF_ROLES).some((id) => String(id) === String(tenantId)),
  )
  if (staff.length === 0) return { sent: 0, failed: 0 }

  // Staff get the studio's first language, as the other studio emails do.
  const locale = tenantLocales(tenant)[0]!
  const localized = await payload.findByID({ collection: 'galleries', id: gallery.id, locale, ...system, depth: 0 })
  const t = getDictionary(locale).emails.selectionSubmitted
  const origin = await siteOrigin(payload, tenant.id)
  const url = `${origin}/admin/collections/gallery-selections/${selection.id}`
  const title = localized.title ?? gallery.title
  const clientName = client.name || client.email
  const subject = t.subject.replace('{client}', clientName).replace('{gallery}', title)

  let sent = 0
  let failed = 0
  for (const member of staff) {
    const { text, html } = renderEmail(
      {
        to: member.email!,
        subject,
        paragraphs: [t.body.replace('{client}', clientName).replace('{gallery}', title)],
        action: { label: t.action, url },
        note: t.note.replace('{studio}', tenant.name),
      },
      tenant.name,
    )
    try {
      await payload.sendEmail({ to: member.email!, from: fromStudio(tenant.name), subject, text, html })
      sent++
    } catch {
      failed++
    }
  }

  if (sent === 0 && failed > 0) {
    await runSql(payload, sql`UPDATE gallery_selections SET staff_notice_for = NULL WHERE id = ${selectionId}`)
    throw new Error(`Selection ${selectionId}: no staff member could be emailed; the job will be tried again.`)
  }
  if (failed > 0) payload.logger.error(`Selection ${selectionId}: ${failed} staff email(s) failed; not retried.`)
  return { sent, failed }
}
