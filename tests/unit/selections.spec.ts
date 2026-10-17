import { describe, expect, it } from 'vitest'

import { quotaReached, selectionCanSubmit, selectionIsLocked } from '@/lib/selections'

describe('selectionIsLocked', () => {
  it('locks while the studio reviews a submitted selection and once it is approved', () => {
    expect(selectionIsLocked('submitted')).toBe(true)
    expect(selectionIsLocked('approved')).toBe(true)
  })

  it('leaves an open selection and one with changes requested editable', () => {
    expect(selectionIsLocked('open')).toBe(false)
    expect(selectionIsLocked('revision-requested')).toBe(false)
    expect(selectionIsLocked(undefined)).toBe(false)
  })
})

describe('selectionCanSubmit', () => {
  it('lets the client submit only when the selection is not locked', () => {
    expect(selectionCanSubmit('open')).toBe(true)
    expect(selectionCanSubmit('revision-requested')).toBe(true)
    expect(selectionCanSubmit('submitted')).toBe(false)
    expect(selectionCanSubmit('approved')).toBe(false)
  })
})

describe('quotaReached', () => {
  it('reaches the limit exactly, and never before it', () => {
    expect(quotaReached(1, 2)).toBe(false)
    expect(quotaReached(2, 2)).toBe(true)
    expect(quotaReached(3, 2)).toBe(true)
  })

  it('has no limit when the gallery sets none, or sets zero', () => {
    expect(quotaReached(500, null)).toBe(false)
    expect(quotaReached(500, undefined)).toBe(false)
    expect(quotaReached(500, 0)).toBe(false)
  })
})
