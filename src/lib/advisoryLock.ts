import { sql } from '@payloadcms/db-postgres'
import type { PayloadRequest } from 'payload'

import { runSql } from '@/lib/sqlSession'

/** Takes a Postgres advisory lock on (namespace, id), held until the current transaction ends. */
export async function advisoryLock(req: PayloadRequest, namespace: number, id: number | string) {
  const transactionID = await req.transactionID
  if (!transactionID) return false
  // The Postgres adapter keeps each open transaction's Drizzle session by its id.
  const sessions = (req.payload.db as unknown as { sessions?: Record<string, unknown> }).sessions
  if (!sessions?.[String(transactionID)]) return false
  await runSql(req.payload, sql`SELECT pg_advisory_xact_lock(${namespace}, ${Number(id)})`, req)
  return true
}
