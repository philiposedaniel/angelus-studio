import type { sql } from '@payloadcms/db-postgres'
import type { Payload, PayloadRequest } from 'payload'

type Execute = (query: ReturnType<typeof sql>) => Promise<unknown>
type SqlSession = { db: { execute: Execute } }

/**
 * Runs a raw SQL query in the request's open transaction when there is one, otherwise on its
 * own connection. Only for what Payload's API cannot express, such as advisory locks and sums.
 * Raw queries skip access rules, so callers filter by ids they have already checked.
 */
export async function runSql<Row extends Record<string, unknown>>(
  payload: Payload,
  query: ReturnType<typeof sql>,
  req?: PayloadRequest,
): Promise<Row[]> {
  const db = payload.db as unknown as { drizzle: { execute: Execute }; sessions?: Record<string, SqlSession> }
  const transactionID = req ? await req.transactionID : undefined
  // The Postgres adapter keeps each open transaction's Drizzle session by its id.
  const session = transactionID ? db.sessions?.[String(transactionID)] : undefined
  const result = (await (session?.db ?? db.drizzle).execute(query)) as { rows?: Row[] }
  return result.rows ?? []
}
