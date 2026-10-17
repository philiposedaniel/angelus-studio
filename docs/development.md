# Development

## Requirements

- Node.js 22 and pnpm 10 (`corepack enable`)
- PostgreSQL 16+ (or Docker: `docker compose up -d postgres`)

## First run

```bash
cp .env.example .env            # then set PAYLOAD_SECRET (openssl rand -hex 32)
pnpm install
pnpm dev                        # http://localhost:3000
```

Then:

```bash
pnpm seed                       # creates the Angelus studio and its site settings
```

Open http://localhost:3000/admin and create the first account. The first account created
through the admin screen becomes the **platform super administrator**. In the admin, add
yourself (or staff) to the studio under *Studio memberships* with the right roles.
http://localhost:3000 redirects to `/en` and shows the studio named by `DEFAULT_TENANT_SLUG`.

## Commands

| Command | What it does |
| --- | --- |
| `pnpm dev` | Development server. Schema changes are pushed to the dev database automatically. |
| `pnpm lint` / `pnpm typecheck` | ESLint and TypeScript checks. |
| `pnpm test:unit` | Unit tests only (no database). |
| `pnpm test:int` | Unit and integration tests (needs `DATABASE_URL`). |
| `pnpm test:e2e` | Playwright tests; starts `pnpm dev` if it is not running. |
| `pnpm build` | Production build. |
| `pnpm migrate:create <name>` | Create a migration after changing collections or globals. |
| `pnpm migrate` | Apply pending migrations. |
| `pnpm generate:types` | Regenerate `src/payload-types.ts`. |
| `pnpm seed` | Create the default studio if it does not exist. |

Set `PLAYWRIGHT_CHROMIUM_PATH` to use an already installed Chromium instead of
`pnpm exec playwright install chromium`.

## Migrations

Development uses schema push. CI and production do not: CI applies the committed migrations
(`PAYLOAD_DB_PUSH=false`), and production runs pending migrations automatically when the app
starts. Every schema change therefore needs `pnpm migrate:create <name>` and a commit.

## Environment variables

| Name | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string. |
| `PAYLOAD_SECRET` | Signs sessions. Long random value, different per environment. |
| `NEXT_PUBLIC_SERVER_URL` | Public base URL, used for links and metadata. |
| `PAYLOAD_DB_PUSH` | Set to `false` to disable dev schema push. |
| `DEFAULT_TENANT_SLUG` | Studio shown when the host name matches no studio domain. |
| `PRIVATE_MEDIA_DIR` | Folder for private client photos. Defaults to `./private-media`. |
| `PAYLOAD_JOBS_AUTORUN` | Set to `false` to stop this process running background jobs (tests set it). |
| `STRIPE_SECRET_KEY` | Stripe API key for Checkout deposits. Leave empty to keep online payment off. |
| `STRIPE_WEBHOOK_SECRET` | Signing secret of the Stripe webhook endpoint `/api/stripe/webhook`. |

## Studios and languages

- A studio's public site is chosen by host name (`tenants.domain`), else `DEFAULT_TENANT_SLUG`.
- Languages: see `docs/decisions/0003-languages.md`. To add one, edit `src/i18n/config.ts`,
  optionally add `src/i18n/dictionaries/<code>.ts`, then create a migration.

## Health check

`GET /healthz` returns `{"status":"ok"}` when the app can reach the database, otherwise 503.

## Client portal and galleries

- Staff create a gallery under *Client delivery → Galleries*, choose the clients who may see it,
  upload photos under *Gallery photos*, then set the status to *Published to clients*.
- Clients sign in at `/<language>/portal`. They see only galleries assigned to them that are
  published and not expired, can mark favorites, and can download originals only when the
  gallery allows downloads.
- Photos are stored outside `public/` and every file request goes through Payload's file route,
  which checks access first. Resized copies (WebP, fitting inside 720px and 1920px) are generated on upload;
  originals are kept untouched.
- With downloads allowed, clients can also download the whole gallery or just their favorites
  as one ZIP. The request creates a *Gallery download* record; a background job builds the ZIP
  in `PRIVATE_MEDIA_DIR/gallery-zips` (photos stored, not recompressed) and the portal polls
  until it is ready. Only its owner and the studio's staff can fetch it, at
  `/api/gallery-downloads/<id>/file`. A ZIP holds up to 2,000 photos, each person has one in
  preparation at a time, and files are deleted after 7 days by an hourly cleanup job.

## Shared albums and embeds

- Staff tick *Share by link* on a gallery; the sidebar then shows the link (`/s/<token>`) and
  an `<iframe>` embed code for any website. The link uses the studio's domain when it has one.
- Anyone with the link sees web-size copies (never originals) of a published, unexpired
  gallery, in a justified grid with a full-screen viewer. Images are served by
  `src/app/s/[token]/p/[photoId]/[size]/route.ts`, which re-checks the link on every request.
- Turning sharing off revokes the link; turning it on again issues a new one.
- Only `/s/<token>/embed` may be framed by other sites (`frame-ancestors *` in
  `next.config.ts`); everything else keeps `X-Frame-Options: SAMEORIGIN`.
- Share pages pick the language from `?lang=` or the browser, among the studio's languages.

## Website pages and embeds

Editors build pages under *Website → Pages* (address `/<language>/<slug>`, optional menu link)
from blocks, defined in `src/blocks/index.ts` and drawn by `src/components/blocks/RenderBlocks.tsx`:

- **Text**: rich text.
- **Video**: a Vimeo (public or unlisted) or YouTube link. Only those hosts are accepted
  (`src/lib/embeds.ts`); YouTube uses the no-cookie player and Vimeo `dnt=1`.
- **Embed code**: any HTML embed (other video hosts, maps, forms). It runs in a sandboxed
  `srcdoc` frame without `allow-same-origin`, so its scripts cannot read this site's cookies or
  page. Embeds that need their own storage or cookies may not work there; prefer the Video block.
- **Google Photos album**: a card with cover and title that opens the album on Google Photos.
  Google does not allow its albums to be shown inside other sites, so there is no inline embed.
- **Photo album**: one of our galleries that is shared by link, shown inline with the viewer.
  It disappears from the page as soon as sharing is turned off.

## Website inquiries

- The homepage contact section has an inquiry form. Requests land in *Sales → Inquiries*, visible
  to the studio's admins, production managers and finance managers (not editors or clients).
- The form posts to a server action (`src/app/(frontend)/[locale]/inquiryAction.ts`); the
  collection itself has no public create access. The studio comes from the host name.
- Spam protection without third-party services (`src/lib/inquiries.ts`): a hidden field bots
  fill in, a signed form token (refused if sent within 3 seconds or after 24 hours), messages
  with more than 3 links dropped, and at most 5 requests per sender and 3 per email address an
  hour. Bots get a normal "thank you" so they learn nothing. Senders are tracked only by a keyed
  hash of their address (`senderKey`), never the address itself.
- Behind a proxy, the client address comes from `CF-Connecting-IP`, `X-Real-IP` or the first
  `X-Forwarded-For` entry; make sure the proxy sets one of these.
- Known limitation: no email notification yet. That needs an email provider (Resend, Postmark…).

## Background jobs

Payload's job queue stores jobs in Postgres, so no Redis is needed yet. The web server runs
queued jobs every 5 seconds and the scheduled ones (ZIP cleanup, hourly) itself, configured in
`jobs` in `src/payload.config.ts`; task code lives in `src/jobs/`. If more than one app instance
is ever run, leave autorun on in one and set `PAYLOAD_JOBS_AUTORUN=false` in the others, or move
jobs to a separate worker process.

- Cookie sessions are only accepted from the site itself (Payload's CSRF rules), so tools like
  curl cannot reuse a browser cookie to fetch private files.

## Quotes and deposits

- Staff create a quote under *Sales → Quotes*: title, client, currency, line items (quantity and
  unit price in minor units, so 12550 means 125.50), and the deposit percentage. Totals and the
  deposit are calculated when saved. The *Client link* box shows the link to copy and send.
- A quote can be sent (*Sent to client*) only when its deposit is at least 0.50 in its currency.
  The client's link works only while the quote is sent and not past its valid-until day.
- Payments appear under *Sales → Payments*. Only admins and finance managers see them. Nobody
  creates or edits them by hand.
- After the deposit is paid, the quote shows *Pay the balance securely* for the rest of the total.
  The balance is a second Checkout session (kind *balance*). Its webhook marks the quote
  *Paid in full*. A balance that arrives before its deposit is recorded is kept on the payment
  and logged, and the quote is not moved.
- **Contract (optional):** the quote's *Contract* section holds terms of up to 10,000 characters.
  With terms, the client reads them on the quote page, types their full name as their signature,
  and ticks the agreement box. Only then does *Pay deposit* appear. The server records the typed
  name, the time, the client's IP address, their browser, and a SHA-256 fingerprint of the exact
  terms. Staff cannot write these fields, and the terms and prices of a signed quote are locked
  (to change them, create a new quote). Without terms, the quote works as before.

### Stripe setup

1. In the Stripe dashboard, copy the secret key into `STRIPE_SECRET_KEY`.
2. Add a webhook endpoint at `https://<studio domain>/api/stripe/webhook`, listening for
   `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
   `checkout.session.expired` (frees the places of tickets left unpaid) and `charge.refunded`
   (records refunds, including ones made in the Stripe dashboard). Copy its signing secret into
   `STRIPE_WEBHOOK_SECRET`.
3. Restart the app. Sent quotes now show *Pay deposit securely*, and paid tickets go on sale.

Use Stripe test keys first. The webhook is covered by tests with signed events; a live
Stripe round trip has not been run yet.

### Known limits

- Each click on *Pay deposit* or *Pay the balance* starts a new Checkout session. A client who pays two
  sessions for the same payment is charged twice; refund the extra payment in Stripe and note it on the quote.
- The quote's text is entered once and is not translated; the interface around it is.
- No email goes out yet. Staff copy the client link into their own email.
- Contract signing is a typed name with a recorded agreement, not a qualified or third-party
  e-signature. No PDF copy of the signed contract is produced yet, so staff copy the terms into
  their own records. The IP address and browser are personal data; how long to keep them is not
  decided yet.
- The admin *Client link* box points at the English page; the client can change language on the site.

## Watermarks on preview copies

- Set *Watermark text* on a gallery (for example your studio name). Clients see it on the preview
  copies, in the client portal and in shared albums. Leave it empty for no watermark.
- The mark sits in the bottom-right corner of the thumbnail and web copies. It is drawn when the
  copy is served, so changing the text takes effect at once, and the stored copies are not changed.
- Staff see clean copies. Originals are never changed. With downloads allowed, a client can still
  download the original, which has no watermark; turn downloads off for galleries that must stay marked.
## Events and guest albums

- Staff create an event under *Events → Events*: title, slug, start (and optional end), time zone,
  location, summary, an optional Vimeo or YouTube live link, and an optional *Album*. The album is a
  client gallery; it must be published with *Share link* on.
- The event page is `/<language>/events/<slug>` and the list is `/<language>/events`. Only published
  events appear, and they show in the event's own time zone.
- Guests get the *Guest link* from the event in the admin and send it to them. It is
  `/<language>/events/<slug>/guests/<token>`. It opens the album only while the event is published
  and the album is published and shared. Otherwise it says the album is not available, or shows nothing.
- The guest token is 32 random characters, set on create and kept on change. Only staff can read it
  through the API. Changing it is not offered yet; to stop a link working, unpublish the event.

- *Show on the website* (on by default) puts a published event on the events list and its public
  page. Untick it for private events such as weddings: the event then opens only through invitation
  and guest links, and the public API does not return it.

Not built yet: guest check-in, per-event printed passes, and separate livestream access control.
Live streams use the Vimeo or YouTube embed only.

## Invitations and RSVP

- Staff add guests under *Events → Guests* (studio admins and production managers only; guest
  details are personal data). Each guest has an event, a name, optional email, phone and group,
  *Party size* (seats on the invitation, the guest included) and the language their link opens in.
- Every guest gets a personal *Invitation link*, `/<language>/invite/<token>` (in the guest's language
  when the studio offers it, otherwise the studio's first language), shown on the guest
  to copy and send. The token is 32 random characters, set on create and kept on change, readable
  only by staff. The link works while the event is published, whether or not it is shown on the website.
- The invitation page shows the event, the live stream and, when the event has an album, a button to
  it. The guest answers attending or not, how many of their party are coming (never more than the
  seats), dietary needs and a note for the hosts, and can change the answer while replies are open.
- On the event, *Invitations and RSVP* shows the headcount (invitations, seats, attending and
  people coming, not attending, not answered), links to the event's guest list, and closes replies
  with *Guests can reply* or a *Reply by* moment in the event's time zone.
- Staff can record an answer given by phone by setting *RSVP* on the guest.
- Answers are saved by the page's server action (`src/lib/rsvp.ts`); guests have no API access.
  The studio comes from the host name, so a link only works on its own studio's site.
- Deleting an event deletes its guests.

### Guest list import and export

- On the event, *Import guests from a spreadsheet* takes a CSV file with a header line: *Name*
  (required), *Email*, *Phone*, *Group*, *Party size* (default 1) and *Language* (`en`, `es`…, default
  the studio's). Common alternatives (Full name, E-mail, Seats, Table…) are recognised, and files
  saved with semicolons work. It first shows how many guests are ready and which lines have problems;
  *Add N guests* then adds them. Guests whose email is already on the event, or repeated in the file,
  are skipped, so importing the same file twice adds nobody with an email. Up to 2,000 rows or 1 MB.
- *Download the guest list (CSV)* exports every guest with their answer, check-in and invitation link.
  Cells that start like a spreadsheet formula get a leading apostrophe so they cannot run.
- Both run at `/api/event-guests/import` and `/api/event-guests/export?event=<id>`, as the signed-in
  user, so only the studio's admins and production managers can use them.

### Check-in at the door

- The invitation page shows the guest an entry code (QR) unless they declined. It opens
  `/<language>/invite/<token>/check-in`.
- Staff sign in on the studio's site first (the check-in page links to the sign-in), then scan codes
  with the phone's camera. The page shows the guest, their party size, answer and dietary needs, and
  records how many arrived (0 undoes it). Anyone else who opens it only sees "Show this code at the
  entrance". Only studio admins and production managers can check guests in.
- The event shows how many people have checked in; each guest shows the count and arrival time, which
  staff can also change by hand.

Known limits: invitations are not emailed yet (that needs the email account); staff copy each
link or send the exported list through their own tools. No seating yet. Scanning uses the phone's own
camera app, so the phone must be signed in to the studio's site in the same browser it opens links in. See `docs/planning/events-platform-plan.md`
for the order of the next steps.

## Projects and crew

- A **project** opens automatically when a quote's deposit is paid (*Production → Projects*). It
  copies the quote's title and client, starts in *Planning*, and is created once per quote.
- Staff with the admin or production manager role plan it: status, shoot day, location, crew with
  roles, and a task list with due dates.
- **Crew conflicts:** saving a project fails if one of its crew is already on another project of the
  same studio on the same day. Pick another person or day.
- Crew must be members of the project's studio; the API refuses anyone else.
- **Crew and client access:** a crew member sees their projects in the portal (*Your productions*),
  with the crew list and tasks. The client assigned on the project (*Client user*, a member of the
  same studio) sees the title, status, shoot day and location. Neither can change a project. Internal
  notes, the quote, the client's email and the client user are for production staff only. Anyone else
  sees an empty list.

- **Call sheet** (on the project): a meeting point, notes for the crew, and a schedule of times, items
  and places. Times are 24-hour *HH:MM*, and saving fails on anything else. Production staff and crew
  can read it; clients cannot. Only admins and production managers can change it.

- **Production calendar** (*/portal/calendar*, linked from the portal home): the studio's productions
  by shoot day, one month at a time, with the month before and after one click away. It lists each
  production's title, status and location only. Each person sees what the project rules let them
  see: staff see all of the studio's productions, and anyone else sees an empty calendar. Events are
  not on it; they stay on the events pages.

## Equipment and reservations

- **Equipment** (*Production → Equipment*): the kit the studio owns, with a name, category, serial
  number and notes. Untick *Active* to retire a piece; retired kit cannot be reserved.
- **Equipment reservations** (*Production → Equipment reservations*): one piece of kit, one production,
  and a start and end time. The end is not included, so one reservation can start the moment another
  ends. The server refuses a reservation that overlaps another for the same kit, that ends before it
  starts, or that uses kit or a production from another studio.
- The database also refuses overlaps, with an exclusion constraint on `equipment_reservations`
  (migration `20261016_120136_equipment_reservations`). It needs the `btree_gist` extension, which
  the migration creates. Two requests at the same moment cannot both book the same kit.
- Only production staff can read or change equipment and reservations. Other studios and clients
  see nothing.
- Not built yet: kit check-out and return, kit lists per production, and a calendar of kit use.

Not built yet: run-of-show timing and printing, the crew's
own view of the call sheet in the portal, and clients uploading or approving anything on their project.


## Vendors

- *Events → Vendors* is the studio's vendor directory: name, category, contact, email, phone,
  website, address and staff-only notes. *Events → Event vendors* books a vendor for one event with
  their role, arrival time, instructions for them, status (proposed, booked, confirmed by vendor,
  cancelled), the agreed fee and what has been paid (in minor units: 12550 means 125.50), and a
  payment due date. Only studio admins and production managers see either.
- The event shows its vendors with arrival times, status and totals due, paid and still to pay per
  currency (cancelled bookings left out), and links to book a vendor.
- Each booking has a private *Vendor link*, `/<language>/vendor/<token>`, to copy and send. It shows
  the event, the vendor's role, arrival time (in the event's time zone) and instructions, and lets
  the vendor confirm with a note for the studio. It never shows amounts or staff notes, and stops
  working when the booking is cancelled. It works whether or not the event is published.
- A vendor who is booked for any event cannot be deleted; remove those bookings first. Deleting an
  event deletes its bookings.

Known limits: vendor documents (contracts, insurance) and vendor payments are not handled yet;
amounts paid are recorded by hand. Vendors are not emailed until the email account exists.

## Seating

- *Events → Tables* adds an event's tables: name (unique within the event), seats and order. The
  same staff who see the guest list (studio admins and production managers) see and change them.
- A guest is seated by choosing their *Table* on the guest; only that event's tables are offered and
  accepted. Several guests can be seated at once with *Edit* on a selection in the guest list.
- The event's *Seating* section shows each table with who sits there and how many seats are taken,
  flags tables over capacity, and lists guests still without a table. Seats count the people coming
  once a guest has answered, every seat on the invitation while they have not, and none after a
  decline.
- Staff checking a guest in at the door see the guest's table. Guests do not see it on their
  invitation. The guest list download has a *Table* column.
- Deleting a table leaves its guests without a table. Deleting an event deletes its tables.

Known limits: seating is a list of tables, not a drawn floor plan, and the guest import does not
assign tables.

## Invitation design

- Each event has an *Invitation design* section: a style (Classic black and gold, Garden ivory
  and sage, Modern white and black), a cover picture, a headline, a message, a programme of
  moments (time, title, place), a dress code, a map link and a closing line. Text fields are
  translated per language like the rest of the event. Whoever may edit the event designs it.
- Every guest's invitation page shows the design above their own greeting, reply form and entry
  code. When the design has a message, the event summary is not repeated on the invitation.
- *Preview the invitation* on the event opens `/<language>/invite/preview/<event id>` on the
  studio's site, one link per site language, with a sample guest and no reply form. Only the
  studio's admins, production managers and editors, signed in on that site, get the preview;
  everyone else gets a 404. Save the event before previewing.
- Styles live in `src/app/(frontend)/[locale]/styles.css` as `invite-theme-*` classes that
  redefine the colour tokens inside the invitation, so new styles are a CSS block plus an entry
  in `src/lib/invitationDesign.ts`.

Known limits: the cover picture comes from website media, which is public. Styles are a fixed
set; there is no per-event colour or font picker yet.

## Event organizers

- An event's *Organizers* field (on the event, in the admin) names the clients hosting it. Only
  members of the event's studio can be chosen, and only staff set it.
- An organizer sees *Your events* on their portal home and, for each event, a guest list at
  `/<language>/portal/events/<id>`: the headcount, each guest's answer, a button to copy their
  personal invitation link, and a form to add, change or remove guests. They can also download the
  guest list as CSV.
- Organizers see and change only the guests of events they organize, in studios they belong to.
  Staff notes on a guest are never shown to them and they cannot write them. Everything is checked
  on the server through the normal access rules, so the same limits apply to the REST API.
- Studio admins and production managers can open the same page for any event of their studio.

Known limits: organizers cannot import guests from CSV, manage seating or vendors, or edit the
event itself from the portal; staff do those in the admin. Organizers are not emailed until the
email account exists.

## Registration and tickets

- *Events → Ticket types* adds the tickets for an event: name and description (translatable), the
  price per place in cents with its currency (0 is free), the number of places, the most places one
  person can book at once (up to 20), optional opening and closing times for registration, *On
  sale*, and order. Once anyone has registered, the price cannot change; add a new ticket type.
- A published event shown on the website lists its ticket types with places left, "Sold out", or
  when registration opens, and shows a registration form while any ticket is on sale. Registration
  closes at the ticket's closing time, or else when the event ends.
- Registering takes a name, an email, an optional phone and consent, and opens the person's ticket
  at `/<language>/tickets/<token>`: the event, the places it admits and an entry code. The form has
  the same protection as the contact form (a signed form token, a hidden field and a minimum fill
  time) and allows 3 registrations per email address and 10 per network address per hour.
- A paid ticket is only offered once Stripe is set up (see *Stripe setup*); until then the event
  page shows it with its price as not available. Registering for one creates a registration
  *waiting for payment* that holds its places for 35 minutes and sends the person to Stripe
  Checkout for the stored price times the places; the Checkout session expires after 31 minutes.
  Only the verified webhook confirms the ticket, after checking the amount and currency. Until
  then the ticket page says the payment is being confirmed and shows no entry code. An expired
  session cancels the registration and frees its places; a missed expiry event changes nothing,
  because the hold simply runs out. A payment that arrives after the hold ran out still confirms
  the ticket, even if that puts the ticket over its places. Payments appear under *Sales →
  Payments* as *Ticket*.
- Capacity is checked in the collection under a database lock (a Postgres advisory lock per ticket
  type, held until the transaction ends), so two people cannot take the last place, whether they
  register on the website or staff add them in the admin. Lowering a ticket type's places below the
  places taken is refused, and a ticket type with registrations cannot be deleted; untick *On sale*.
- *Events → Registrations* lists everyone registered. Staff can add a registration by hand (for a
  phone booking), cancel one (which frees its places and stops the ticket working at the door) and
  copy its ticket link to resend it. The event's *Registration and tickets* section shows places
  taken, left and checked in per ticket type. Only studio admins and production managers see ticket
  types and registrations.
- *Download the attendee list (CSV)* in that section gives everyone registered for the event: name,
  email, phone, ticket, places, status (confirmed, waiting for payment, not paid, cancelled), amount
  and currency, language, when they registered, how many checked in and their ticket link. It is
  served by `GET /api/registrations/export?event=<id>` and read with the signed-in user's own
  access, so only the studio's admins and production managers get it. Cells a spreadsheet would
  run as formulas are kept as text.
- A registration paid online shows a *Payment* section to studio admins and finance managers,
  with *Refund … and cancel*. After a second click it asks Stripe to refund the full amount (with
  an idempotency key, so a repeated click never refunds twice), marks the payment *Refund
  requested* and cancels the registration at once, which stops the ticket at the door and gives
  its places back (to the waitlist first, if anyone waits). Only the verified `charge.refunded`
  webhook marks the payment *Refunded*. A full refund made in the Stripe dashboard also cancels
  the registration; a partial one is recorded on the payment and keeps the ticket. If Stripe
  refuses, nothing changes.
- Tickets are paid by card (including card wallets) only, so a payment never arrives days after its
  held places went to someone else. Once a registration has a price, staff cannot change its
  places or ticket (cancel it and add a new one), and the payment hold is set only by the website.
  Staff change only the status of a waitlist entry. Payment records cannot be deleted by studio
  admins.
- The entry code opens `/<language>/tickets/<token>/check-in`. Signed-in admins and production
  managers of the studio record how many have arrived, as for invitations; anyone else is only told
  to show the code. A cancelled registration shows "Do not admit".
- *Events → Promo codes* adds codes for an event's paid tickets: the code (letters, digits, - and
  _; people can type it in any case), a percentage off the order (100 makes it free) or a fixed
  amount off each place in cents of the ticket's currency, optionally only some of the event's
  tickets, the dates it works between, and how many places can be bought with it in all. The
  event page asks for a code only while the event has an active one and a paid ticket is on sale.
  The price is worked out on the server when the registration is saved, and the code's limit is
  counted under its own database lock, so it cannot be overrun. With a discount the person pays
  the reduced total through Stripe Checkout as a single line; a code that makes the places free
  confirms them at once without a payment. Registrations keep the code and the amount taken off,
  and a code someone used cannot be deleted (untick *Active* instead). Only studio admins and
  production managers see promo codes.
- A sold-out ticket that is still selling has a waitlist. The event page shows a *Join the
  waitlist* form (same fields and protection as registering; 3 joins per email address and 10 per
  network address per hour, one active place in line per email address per ticket), and joining
  opens the person's waitlist link at `/<language>/waitlist/<token>`, which shows their place in
  line. When places free up (a cancellation, an unpaid hold or offer running out, fewer places on
  a registration, more places on the ticket, or the ticket going back on sale), they are offered
  to the people waiting strictly in the order they joined, and held for them for 24 hours; if the
  next person needs more places than are free, everyone behind them waits too. While anyone is
  waiting the ticket stays sold out to the public, so freed places never go to someone who did
  not wait. An offered person takes the places from their link: a free ticket opens at once, a
  paid one goes to Stripe Checkout like any paid registration (its usual 35-minute hold applies).
  An offer not taken in time passes to the next person, and anyone can leave the queue from their
  link.
- *Events → Waitlist* lists everyone waiting, with their status and waitlist link to resend.
  Staff can take someone off (*Removed by staff*) but cannot offer places by hand; offers follow
  the queue. The event's *Registration and tickets* section shows how many are on each waitlist.
  Offers and holds run out with time, so the queue is brought up to date whenever places are given
  back and whenever the event page or a waitlist link is opened; there is no background timer.
- Deleting an event deletes its ticket types, registrations and waitlists.

Known limits: refunds from the admin are for the full amount (refund part of it in Stripe). No
booking fee is added (decision 6 in the events plan is open). Paid tickets have been tested with
signed webhook events, not yet with a live Stripe round trip. Tickets are not emailed until the email account exists, so the ticket page asks people
to save its link, and staff can resend it from the registration. One entry code covers every place
on a registration. Nobody is told by email when places are offered to them from the waitlist
until the email account exists; they see it on their waitlist link, and staff can resend that
link. A person who takes a paid offer but does not pay loses it like any unpaid hold. Wrong promo codes are
not counted against a limit of their own; the form token and minimum fill time slow guessing, so
avoid short codes for large discounts.
