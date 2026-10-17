import { sql } from '@payloadcms/db-postgres'
import type { PayloadRequest } from 'payload'

type SqlSession = { db: { execute: (query: ReturnType<typeof sql>) => Promise<unknown> } }

/** Takes a Postgres advisory lock on (namespace, id), held until the current transaction ends. */
export async function advisoryLock(req: PayloadRequest, namespace: number, id: number | string) {
  const transactionID = await req.transactionID
  if (!transactionID) return false
  // The Postgres adapter keeps each open transaction's Drizzle session by its id.
  const sessions = (req.payload.db as unknown as { sessions?: Record<string, SqlSession> }).sessions
  const session = sessions?.[String(transactionID)]
  if (!session) return false
  await session.db.execute(sql`SELECT pg_advisory_xact_lock(${namespace}, ${Number(id)})`)
  return true
}
