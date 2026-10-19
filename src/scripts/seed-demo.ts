/**
 * Fills an empty preview database with demo records and prints the sign-ins and links.
 * Refuses a database that already has real accounts. Usage: pnpm seed:demo
 */
import config from '@payload-config'
import { getPayload } from 'payload'

import { DemoDataRefused, seedDemoData } from '@/lib/demoData'

const payload = await getPayload({ config })
// Results are printed and flushed before exiting. The logger, and console.log when output goes to a
// pipe as in Docker, write asynchronously, and process.exit can drop their last lines, which has
// hidden "Demo data created" from the preview's log.
const print = (stream: NodeJS.WriteStream, text: string) =>
  new Promise<void>((resolve) => stream.write(`${text}\n`, () => resolve()))
const base = (process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3000').replace(/\/$/, '')

try {
  const result = await seedDemoData(payload, {
    tenantSlug: process.env.DEFAULT_TENANT_SLUG || 'angelus',
  })
  if (!result.created) {
    await print(
      process.stdout,
      `Demo data is already in place. Sign in as ${result.admin.email} or ${result.client.email}.`,
    )
  } else {
    const lines = [
      'Demo data created.',
      `Studio administrator: ${result.admin.email} / ${result.admin.password}`,
      `Client: ${result.client.email} / ${result.client.password}`,
      ...result.links.map((l) => `${l.label}: ${base}${l.path}`),
    ]
    await print(process.stdout, lines.join('\n'))
  }
  process.exit(0)
} catch (error) {
  if (error instanceof DemoDataRefused) {
    await print(process.stderr, error.message)
    process.exit(1)
  }
  throw error
}
