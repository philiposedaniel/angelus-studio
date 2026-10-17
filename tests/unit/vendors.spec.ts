import { describe, expect, it } from 'vitest'

import { summarizeVendorCosts } from '@/lib/vendors'

describe('summarizeVendorCosts', () => {
  it('totals what is due and paid per currency, leaving cancelled bookings out', () => {
    expect(
      summarizeVendorCosts([
        { status: 'confirmed', amountDue: 120000, amountPaid: 50000, currency: 'eur' },
        { status: 'booked', amountDue: 30000, amountPaid: 0, currency: 'eur' },
        { status: 'cancelled', amountDue: 99999, amountPaid: 0, currency: 'eur' },
        { status: 'proposed', amountDue: 20000, amountPaid: 20000, currency: 'gbp' },
      ]),
    ).toEqual({
      active: 3,
      confirmed: 1,
      totals: [
        { currency: 'eur', due: 150000, paid: 50000, outstanding: 100000 },
        { currency: 'gbp', due: 20000, paid: 20000, outstanding: 0 },
      ],
    })
  })
})
