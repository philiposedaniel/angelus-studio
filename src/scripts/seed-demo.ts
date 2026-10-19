/**
 * Fills an empty preview database with demo records and prints the sign-ins and links.
 * Refuses a database that already has real accounts. Usage: pnpm seed:demo
 */
import config from '@payload-config'
import { getPayload } from 'payload'

import { DemoDataRefused, seedDemoData } from '@/lib/demoData'

const payload = await getPayload({ config })
// Payload's logger writes asynchronously and process.exit() below can drop what it has not
// written yet, so the result goes straight to stdout/stderr (the preview's CI check greps it).
const print = (line: string) => process.stdout.write(`${line}\n`)
const base = (process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3000').replace(/\/$/, '')

try {
  const result = await seedDemoData(payload, {
    tenantSlug: process.env.DEFAULT_TENANT_SLUG || 'angelus',
  })
  if (!result.created) {
    print(`Demo data is already in place. Sign in as ${result.admin.email} or ${result.client.email}.`)
  } else {
    const lines = [
      'Demo data created.',
      `Studio administrator: ${result.admin.email} / ${result.admin.password}`,
      `Client: ${result.client.email} / ${result.client.password}`,
      ...result.links.map((l) => `${l.label}: ${base}${l.path}`),
    ]
    print(lines.join('\n'))
  }
  process.exit(0)
} catch (error) {
  if (error instanceof DemoDataRefused) {
    process.stderr.write(`${error.message}\n`)
    process.exit(1)
  }
  throw error
}
