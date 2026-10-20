# Access review: server calls that bypass access rules

Checked on `main` at 89a298e. Every server call that passes `overrideAccess: true` (149 in `src/`) runs
with full database rights, so each one must either serve a token or system task, or check the studio
and the role itself. This review records how each group is kept safe, and what is left open.

## Groups

| Group | Why it is safe |
| --- | --- |
| Token pages and actions: quote, invite, check-in, guests, vendor, waitlist | The record is found by a share token **and** the current studio (`tenant`). Nothing is returned unless the token matches. The check-in page shows guest details only after `canCheckIn` passes. |
| Public checkout: tickets, RSVP, waitlist claim | The event must belong to this studio, be published and listed, and the ticket type must belong to that event. Forms carry a time-limited token and spam checks. |
| Stripe webhook and refunds | Runs only after a signed webhook is verified. Payments and quotes change only by their own ids. The installment branch is in `src/lib/stripeWebhook.ts`. |
| Collection hooks (events, ticket types, registrations, promo codes, guests, tables, vendors, event vendors, equipment, projects, galleries, favorites) | Hooks look up a parent record only to take its studio, then compare it with the studio of the staff member (`hasTenantRole`) or the event's organizers (`isOrganizerOf`). A record cannot be moved to another studio. |
| Lookups of users, MFA, selections | Keyed by the signed-in user's own id, taken from the session, never from the form. A client's selection is first read with the client's own access (`overrideAccess: false`). |
| Jobs and system mail (reminders, notices, demo data) | Run without a user. Each query filters by studio and status. |

Portal pages read with `overrideAccess: false`, for example the galleries list and the calendar.

This review read the main call site of each group, not every call line by line. Calls that were not read
closely should be checked when they are next changed.

## Open items

- **Duplicate installment or balance payments.** Two Checkout sessions for the same installment can both be
  paid. The checkout refuses an installment already recorded as paid, but not one that is still waiting, so
  the webhook records both as paid. The client is then charged twice, and the invoice's amount due stays at
  zero. Nothing refunds it automatically. Staff refund the extra payment in Stripe. The same is true of the
  balance payment today.
- **Tests.** Cross-studio tests exist for the collections above (`tests/int/access.int.spec.ts`,
  `staffRoleReads.int.spec.ts`, `projectAccess.int.spec.ts`, `publicTokens.int.spec.ts`).

## Rule for new code

A new `overrideAccess: true` call needs a comment that says which of the groups above it belongs to, and a
check of the studio before its result is used. Calls made for a user pass `user` and `overrideAccess: false`
unless they only look up a value they then check in code.
