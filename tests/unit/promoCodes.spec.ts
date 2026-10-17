import { describe, expect, it } from 'vitest'

import { normalizePromoCode, promoApplies, promoDiscount, withinLimit } from '@/lib/promoCodes'

const NOW = Date.parse('2027-05-01T12:00:00Z')
const ticket = { id: 7, event: 3, price: 2500 }
const promo = { event: 3, active: true, startsAt: null, endsAt: null, ticketTypes: [] as number[] }

describe('normalizePromoCode', () => {
  it('accepts any case and spaces around, and refuses anything else', () => {
    expect(normalizePromoCode(' early-bird_10 ')).toBe('EARLY-BIRD_10')
    expect(normalizePromoCode('ab')).toBeNull()
    expect(normalizePromoCode('two words')).toBeNull()
    expect(normalizePromoCode(42)).toBeNull()
  })
})

describe('promoDiscount', () => {
  it('takes a percentage of the order, rounded to the cent', () => {
    expect(promoDiscount({ discountType: 'percent', percentOff: 10, amountOff: null }, 2500, 2)).toBe(500)
    expect(promoDiscount({ discountType: 'percent', percentOff: 33, amountOff: null }, 999, 1)).toBe(330)
    expect(promoDiscount({ discountType: 'percent', percentOff: 100, amountOff: null }, 2500, 3)).toBe(7500)
  })

  it('takes a fixed amount off each place, never more than the place costs', () => {
    expect(promoDiscount({ discountType: 'amount', percentOff: null, amountOff: 1000 }, 2500, 2)).toBe(2000)
    expect(promoDiscount({ discountType: 'amount', percentOff: null, amountOff: 9000 }, 2500, 2)).toBe(5000)
  })
})

describe('promoApplies', () => {
  it("works only on the event's paid tickets, inside its dates, while active", () => {
    expect(promoApplies(promo, ticket, NOW)).toBe(true)
    expect(promoApplies(promo, { ...ticket, price: 0 }, NOW)).toBe(false)
    expect(promoApplies(promo, { ...ticket, event: 4 }, NOW)).toBe(false)
    expect(promoApplies({ ...promo, active: false }, ticket, NOW)).toBe(false)
    expect(promoApplies({ ...promo, startsAt: '2027-05-02T00:00:00Z' }, ticket, NOW)).toBe(false)
    expect(promoApplies({ ...promo, endsAt: '2027-04-30T00:00:00Z' }, ticket, NOW)).toBe(false)
  })

  it('can be kept to some tickets', () => {
    expect(promoApplies({ ...promo, ticketTypes: [7] }, ticket, NOW)).toBe(true)
    expect(promoApplies({ ...promo, ticketTypes: [8] }, ticket, NOW)).toBe(false)
  })
})

describe('withinLimit', () => {
  it('counts places against the limit, if there is one', () => {
    expect(withinLimit({ maxUses: 3 }, 2, 1)).toBe(true)
    expect(withinLimit({ maxUses: 3 }, 2, 2)).toBe(false)
    expect(withinLimit({ maxUses: null }, 500, 20)).toBe(true)
  })
})
