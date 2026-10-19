import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * Browser components may take plain values from src/lib, but only from files that do not load
 * the database, Payload or Node's crypto: the bundler copies whatever such a file imports into
 * the page's JavaScript, which once added 430 KB to every invitation.
 */

const SRC = path.resolve(__dirname, '../../src')
const SERVER_ONLY = /^(payload|@payloadcms\/.+|crypto|node:.+|sharp|next\/headers|server-only)$/

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) return sourceFiles(full)
    return /\.tsx?$/.test(name) ? [full] : []
  })
}

function resolveLib(specifier: string): string | null {
  const base = path.join(SRC, specifier.replace(/^@\//, ''))
  for (const candidate of [`${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')]) {
    try {
      if (statSync(candidate).isFile()) return candidate
    } catch {}
  }
  return null
}

/** Modules a file imports values (not only types) from. */
function valueImports(source: string): string[] {
  return [...source.matchAll(/^import (?!type )[^;]*?from '([^']+)'/gm)]
    .filter((m) => !/^import \{\s*(type [^,}]+,?\s*)+\}/.test(m[0]))
    .map((m) => m[1]!)
}

describe('browser components', () => {
  const clientFiles = sourceFiles(SRC).filter((file) =>
    /^['"]use client['"]/.test(readFileSync(file, 'utf8')),
  )

  it('are found', () => {
    expect(clientFiles.length).toBeGreaterThan(10)
  })

  it('only take values from src/lib files that stay out of the server', () => {
    const offending: string[] = []
    for (const file of clientFiles) {
      for (const specifier of valueImports(readFileSync(file, 'utf8'))) {
        if (!specifier.startsWith('@/lib/')) continue
        const lib = resolveLib(specifier)
        if (lib && valueImports(readFileSync(lib, 'utf8')).some((m) => SERVER_ONLY.test(m))) {
          offending.push(`${path.relative(SRC, file)} imports ${specifier}`)
        }
      }
    }
    expect(offending).toEqual([])
  })
})
