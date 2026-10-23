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
| Public availability page (`/availability`) | The studio comes from the request's host, never from the URL. `busyDays` runs two queries, each filtered by that studio's `tenant`, and returns only `YYYY-MM-DD` days. No title, client, place or count leaves the server. Tests in `tests/int/availability.int.spec.ts` show another studio's published event or confirmed shoot does not block a day. |

Portal pages read with `overrideAccess: false`, for example the galleries list and the calendar.

This review read the main call site of each group, not every call line by line. Calls that were not read
closely should be checked when they are next changed.

## Open items

- **Duplicate deposit, balance or installment payments.** A new payment page now expires every older page for
  the same deposit, balance or installment that is still waiting (`src/lib/paymentSessions.ts`). If Stripe
  refuses to expire an older page, because it was just paid, no new page opens. What remains is a narrow race:
  a client pays an older page in the same moment the newer one is opened. Both payments are then recorded as
  paid, and nothing refunds the extra one automatically. Staff refund it in Stripe. The admin guide says so.
  The webhook is unchanged: it records every verified payment.
- **Tests.** Cross-studio tests exist for the collections above (`tests/int/access.int.spec.ts`,
  `staffRoleReads.int.spec.ts`, `projectAccess.int.spec.ts`, `publicTokens.int.spec.ts`). The expiry rule is
  tested in `tests/int/paymentSessions.int.spec.ts`; the page action that calls it needs Stripe and is covered
  by the webhook and checkout checks only.

## Availability page: what a day means

- A day is shown as **Booked** when a production in a booked status (confirmed, in production, delivered) has that shoot date, or
  when a **published** event starts that day in the event's time zone. Drafts do not count.
- **Unlisted** events are published too, so they also mark their day as Booked. The page shows the day only, so a private
  event's date becomes visible to anyone who opens the availability page. The owner should decide whether that is
  acceptable; the code is unchanged for now.
- Days before today (the studio's day in Europe/Lisbon) are shown as **Past**, never as **Free**, so a visitor cannot read
  a date that has gone as bookable. `dayStatus` in `src/lib/availability.ts` is unit tested for this.
- Events have no cancelled status. A cancelled event must be unpublished to free its day.

## Rule for new code

A new `overrideAccess: true` call needs a comment that says which of the groups above it belongs to, and a
check of the studio before its result is used. Calls made for a user pass `user` and `overrideAccess: false`
unless they only look up a value they then check in code.
