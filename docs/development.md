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

### Stripe setup

1. In the Stripe dashboard, copy the secret key into `STRIPE_SECRET_KEY`.
2. Add a webhook endpoint at `https://<studio domain>/api/stripe/webhook`, listening for
   `checkout.session.completed` and `checkout.session.async_payment_succeeded`. Copy its
   signing secret into `STRIPE_WEBHOOK_SECRET`.
3. Restart the app. Sent quotes now show *Pay deposit securely*.

Use Stripe test keys first. The webhook is covered by tests with signed events; a live
Stripe round trip has not been run yet.

### Known limits

- Each click on *Pay deposit* starts a new Checkout session. A client who pays two sessions is
  charged twice; refund the extra payment in Stripe and note it on the quote.
- The quote's text is entered once and is not translated; the interface around it is.
- No email goes out yet. Staff copy the client link into their own email.
- Only deposits are taken online. Balance payments and contract signing come later.
- The admin *Client link* box points at the English page; the client can change language on the site.

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

Not built yet: run-of-show timing and printing, equipment reservations, calendar views, the crew's
own view of the call sheet in the portal, and clients uploading or approving anything on their project.

