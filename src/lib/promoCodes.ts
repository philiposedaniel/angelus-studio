import { sql } from '@payloadcms/db-postgres'
import type { Payload, PayloadRequest } from 'payload'

import { idOf } from '@/lib/ids'
import { advisoryLock } from '@/lib/advisoryLock'
import { runSql } from '@/lib/sqlSession'
import type { PromoCode, TicketType } from '@/payload-types'

/** Letters, digits, dashes and underscores; stored and compared in capitals. */
export const PROMO_CODE_PATTERN = /^[A-Z0-9_-]{3,40}$/
export const PROMO_DISCOUNT_TYPES = ['percent', 'amount'] as const

/** Error status the registrations collection uses when a promo code cannot be used. */
export const PROMO_INVALID_STATUS = 422

// Keeps these advisory locks apart from the ticket type locks and any other use.
const PROMO_LOCK_NAMESPACE = 7_302

/** The code as people may type it (any case, spaces around), in its stored form, or null. */
export function normalizePromoCode(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const code = value.trim().toUpperCase()
  return PROMO_CODE_PATTERN.test(code) ? code : null
}

type Discounting = Pick<PromoCode, 'discountType' | 'percentOff' | 'amountOff'>

/**
 * What a code takes off an order of `quantity` places at `price` each, in minor units: a
 * percentage of the total (rounded to the nearest unit), or a fixed amount off each place.
 * Never more than the order costs.
 */
export function promoDiscount(promo: Discounting, price: number, quantity: number) {
  const total = price * quantity
  const discount =
    promo.discountType === 'percent'
      ? Math.round((total * (promo.percentOff ?? 0)) / 100)
      : Math.min(price, promo.amountOff ?? 0) * quantity
  return Math.max(0, Math.min(total, discount))
}

type Usable = Pick<PromoCode, 'event' | 'active' | 'startsAt' | 'endsAt' | 'ticketTypes'>

/** Whether a code applies to this paid ticket type now, before counting how often it was used. */
export function promoApplies(promo: Usable, ticketType: Pick<TicketType, 'id' | 'event' | 'price'>, now = Date.now()) {
  if (promo.active === false || (ticketType.price ?? 0) <= 0) return false
  if (String(idOf(promo.event)) !== String(idOf(ticketType.event))) return false
  if (promo.startsAt && new Date(promo.startsAt).getTime() > now) return false
  if (promo.endsAt && new Date(promo.endsAt).getTime() < now) return false
  const limitedTo = (promo.ticketTypes ?? []).map((t) => String(idOf(t)))
  return limitedTo.length === 0 || limitedTo.includes(String(ticketType.id))
}

/** An event's promo code by what someone typed, or null. */
export async function findPromoCode(payload: Payload, eventId: number | string, typed: unknown, req?: PayloadRequest) {
  const code = normalizePromoCode(typed)
  if (!code) return null
  const { docs } = await payload.find({
    collection: 'promo-codes',
    where: { and: [{ event: { equals: eventId } }, { code: { equals: code } }] },
    limit: 1,
    depth: 0,
    overrideAccess: true,
    ...(req ? { req } : {}),
  })
  return docs[0] ?? null
}

/** Places bought with a code that still count: confirmed, or held while someone pays. */
export async function promoPlacesUsed(
  payload: Payload,
  promoId: number | string,
  { req, excludeId, now = Date.now() }: { req?: PayloadRequest; excludeId?: number | string; now?: number } = {},
) {
  // Summed in the database, like places taken on a ticket type; mirrors `holdsPlaces`.
  const skip = excludeId === undefined ? null : Number(excludeId)
  const [row] = await runSql<{ used: string | null }>(
    payload,
    sql`SELECT COALESCE(SUM(quantity), 0) AS used FROM registrations
      WHERE promo_code_id = ${Number(promoId)}
        AND (status = 'confirmed' OR (status = 'pending' AND hold_expires_at > ${new Date(now).toISOString()}::timestamptz))
        AND (${skip}::int IS NULL OR id <> ${skip}::int)`,
    req,
  )
  return Number(row?.used ?? 0)
}

/** Holds a lock on one promo code until the transaction ends, so its limit cannot be overrun. */
export const lockPromoCode = (req: PayloadRequest, promoId: number | string) =>
  advisoryLock(req, PROMO_LOCK_NAMESPACE, promoId)

/** Whether `quantity` more places fit within the code's limit. */
export const withinLimit = (promo: Pick<PromoCode, 'maxUses'>, used: number, quantity: number) =>
  promo.maxUses === null || promo.maxUses === undefined || used + quantity <= promo.maxUses

/** Whether an event has any code that could work, so its page asks for one. */
export async function eventHasPromoCodes(payload: Payload, eventId: number | string, now = Date.now()) {
  const moment = new Date(now).toISOString()
  const { totalDocs } = await payload.count({
    collection: 'promo-codes',
    where: {
      and: [
        { event: { equals: eventId } },
        { active: { not_equals: false } },
        { or: [{ endsAt: { exists: false } }, { endsAt: { equals: null } }, { endsAt: { greater_than: moment } }] },
      ],
    },
    overrideAccess: true,
  })
  return totalDocs > 0
}
