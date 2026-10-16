# Event platform plan: events, booking, vendors, audio/video, invitations

Daniel's ask (2026-10-16): add complete event management and booking, vendors, audio/video,
and invitations and guest management, at the scope of Eventbrite + HoneyBook + Planning Pod +
a professional media delivery portal. This plan works from what is already in `main` and
follows the order in `platform-analysis.md` section 6 (production management is phase 6,
invitations and RSVP phase 7, video phase 8).

## 1. Where each area stands

| Area | Already built | Missing |
|---|---|---|
| **Event management and booking** (Eventbrite + HoneyBook) | Event pages with date, time zone, place, live link (`events`). Inquiry form with an admin inbox. Quotes with Stripe deposits confirmed by signed webhook. | Public registration and tickets (ticket types, capacity, paid tickets, orders, attendee tickets with QR), waitlist, promo codes, refunds. Contracts and e-signature. Invoices, payment schedules and balance payments. Booking calendar and availability. Client CRM view. Email confirmations and reminders. |
| **Vendors** (Planning Pod) | Nothing. | Vendor directory (category, contacts, rates, notes). Vendors assigned to an event with role, arrival time, status and amount due. Vendor documents (contracts, insurance) in private storage. A vendor link showing their event details and timeline. |
| **Audio and video** | Vimeo and YouTube embeds on pages and as an event's live link; sandboxed embed code. | Private video and audio delivery to clients (signed playback, downloads of masters), versions and timecoded review comments, private live streams with access control. |
| **Invitations and guest management** (Planning Pod, Zola/Greenvelope) | An event guest link that opens the event album. | Guest lists, parties with plus-ones, personal invitation links, RSVP with meal choice and notes, headcount, CSV import and export, email invitations and reminders, seating and tables, QR check-in at the door, designed invitation templates. |
| **Media delivery portal** | Private galleries, favorites, ZIP downloads, share-by-link albums and embeds; watermarks in PR #9. | Move private files to R2 with signed URLs, proofing selections with limits, video in the same portal. |

## 2. Build order

Each step is one pull request from `main`, with tests that try to cross studio boundaries.
Production management (projects, scheduling, crew, tasks, run-of-show) is owned by the
"Media platform plan and approach" thread and waits for Daniel's go there; nothing below
depends on it.

1. **Guest list and RSVP** (done, PR #11). Guests per event, each with a personal invitation link;
   guests answer attending or not, how many of their party, dietary needs and a note, and can
   change the answer until the deadline. Staff see the headcount on the event. *Needs nothing.*
2. **Guest list import, export and check-in** (PR #13). CSV import with a preview, CSV export, and a
   staff check-in page that scans the QR code on the invitation. *Needs nothing.*
3. **Event registration and tickets.** Ticket types with price, capacity and sales window;
   free registration; paid tickets through Stripe Checkout reusing the signed webhook; orders
   and attendee tickets with QR codes that the check-in page also accepts. *Needs Stripe test keys.*
4. **Vendors** (PR #22; private documents come with R2 storage, step 8). Directory, per-event assignments, amounts due and paid, private documents,
   and a vendor link with their event details. *Needs nothing; documents stay on local disk
   until R2.*
5. **Email.** Invitations, RSVP and ticket confirmations, reminders, vendor notices and
   inquiry alerts, sent through one provider interface. *Needs the email account.*
6. **Contracts, invoices and balances** (HoneyBook). Contract from a quote, e-signature,
   invoices with a payment schedule, balance payments by Stripe. *Needs the e-signature
   choice and Stripe.*
7. **Private video and audio delivery.** Upload to the video provider, signed playback in the
   portal, versions and timecoded review comments, private live streams per event. *Needs the
   video provider account.*
8. **Storage on R2.** Private originals, ZIPs and vendor documents move to R2 with direct
   uploads and short-lived signed URLs. *Needs Cloudflare.*
9. **Organizer self-service.** Clients with the existing *Event organizer* role manage their
   own guest lists, vendors and tickets from the portal instead of through the studio.
10. **Seating and invitation design** (both built). Tables per event with guests seated at them
    and the table shown at check-in; invitation pages in a chosen style with cover, programme,
    dress code and map, and a staff preview.

Steps 1, 2 and 4 need nothing from Daniel and can go back to back. Steps 3, 5, 7 and 8 start
as soon as the account each needs exists.

## 3. Decisions only Daniel can make

1. **Ticket money for other studios (SaaS):** tickets sold on Angelus's own Stripe account now,
   and Stripe Connect (each studio paid directly, with an optional platform fee) when the
   platform is sold to other studios. Recommended: yes, Connect later.
2. **Video provider:** Cloudflare Stream (recommended, same account as R2) or Mux.
3. **E-signature:** Documenso self-hosted on his server (recommended) or a hosted service.
4. **How vendors get in:** private links per vendor and event (recommended to start) or vendor
   accounts that sign in.
5. **Who manages guest lists:** studio staff only (as built now), or also the client hosting the
   event, through the portal (step 9).
6. **Ticket fees:** whether buyers pay a booking fee on top of the ticket price.

## 4. Accounts and services needed

| Account | Unlocks |
|---|---|
| Email sending (Resend or Postmark) | Step 5, and email on every existing flow |
| Stripe test keys, later live | Step 3 and step 6; deposits already wait on it |
| Cloudflare (R2, and Stream if chosen) | Steps 7 and 8 |
| Documenso (self-hosted, or an account) | Step 6 |
