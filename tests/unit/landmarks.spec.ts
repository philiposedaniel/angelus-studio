import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * The locale layout renders the page's one main landmark (`<main id="main">`, the skip link's target).
 * A page or component inside it that opens its own `<main>` gives screen readers two main regions.
 */

const SRC = path.resolve(__dirname, '../../src')
const LOCALE_ROOT = path.join(SRC, 'app/(frontend)/[locale]')
const LAYOUT = path.join(LOCALE_ROOT, 'layout.tsx')

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) return sourceFiles(full)
    return /\.tsx$/.test(name) ? [full] : []
  })
}

describe('main landmark', () => {
  it('is rendered by the locale layout', () => {
    expect(readFileSync(LAYOUT, 'utf8')).toMatch(/<main\b[^>]*id="main"/)
  })

  it('is not opened again by any page or component inside it', () => {
    const files = [
      ...sourceFiles(LOCALE_ROOT),
      ...sourceFiles(path.join(SRC, 'components')),
    ].filter((file) => file !== LAYOUT)
    const offenders = files
      .filter((file) => /<main\b/.test(readFileSync(file, 'utf8')))
      .map((file) => path.relative(SRC, file))
    expect(offenders).toEqual([])
  })
})
