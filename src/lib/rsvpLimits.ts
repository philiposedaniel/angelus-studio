// Plain values shared with the reply and guest forms in the browser. Kept apart from rsvp.ts,
// which imports the database and Node's crypto and would pull them into the page's JavaScript.

/** Most seats one invitation can hold (the guest plus their party). */
export const MAX_PARTY_SIZE = 20

export const RSVP_LIMITS = { dietaryNotes: 500, guestMessage: 1000, personName: 120 } as const
