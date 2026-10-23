import { describe, expect, it } from 'vitest'

import { parseRowId } from '@/lib/ids'

describe('parseRowId', () => {
  it('reads ids the database can hold', () => {
    expect(parseRowId('1')).toBe(1)
    expect(parseRowId('42')).toBe(42)
    expect(parseRowId('2147483647')).toBe(2_147_483_647)
  })

  it('refuses anything else, so it never reaches Postgres', () => {
    for (const value of ['', '0', '-1', '1.5', '1e3', ' 1', 'x', '2147483648', '9999999999', '99999999999999'])
      expect(parseRowId(value)).toBeNull()
  })
})
