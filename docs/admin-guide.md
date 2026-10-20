# Administrator guide

This guide is for studio administrators and staff who run the day-to-day work in the Angelus Studio admin
(`/admin`). It describes only what is on `main` today. Features still in review add their own sections when
they merge. Labels and status values below are the ones shown in the admin.

Clients and crew use the public site and the client portal; see [client-guide.md](client-guide.md).

## Who can do what

Each person has a role per studio. Access is enforced on the server, so hiding a button is never the only
control.

| Role | Typical use |
| --- | --- |
| Studio administrator (`admin`) | Everything in the studio, including deleting projects and payments. |
| Production manager (`production-manager`) | Creates and runs productions, crew, tasks and call sheets. |
| Photographer, videographer, editor | Works on productions and galleries they are given access to. |
| Finance manager (`finance-manager`) | Quotes and payments. |
| Event organizer (`event-organizer`) | Manages the guest list of the events they are assigned to. |
| Client (`client`) | Sees only what is assigned to them in the client portal. |

Platform super-admins can work across studios. Each studio's records are kept apart from other studios.

## Signing in with an authenticator app

Staff can add an authenticator app (any app that makes six-digit time-based codes, such as Google
Authenticator, 1Password or Aegis) to their account. Once it is on, signing in needs a current code as well as
the password.

1. Sign in at `/portal/login` and open **Security** from the portal.
2. Add the shown setup key to the app, choosing time-based codes, or open the setup link on a phone with the app.
3. Type the six-digit code the app shows and press **Turn on**. A wrong code changes nothing.
4. To turn it off, type a current code and press **Turn off**.

Sign-in details:

- Staff who have it on sign in to `/portal/login` with the code. To reach `/admin`, sign in there first, then
  open `/admin`.
- Five wrong codes in a row lock the code check for 15 minutes. A code can be used once.
- A studio administrator of the same studio can turn it off for a staff member (their user record, tick
  **Turn off authenticator sign-in** and save). Platform super-admins can too. Other studios cannot.

Known limitations: there are no recovery codes yet, so a lost phone is cleared by a studio administrator. Only
the authenticator app is offered; email codes are not.

## Quotes and contracts

Quotes live under **Sales > Quotes**.

1. Create a quote with a title, client name and email, currency, and line items (description, quantity,
   unit amount). Totals are calculated for you, in minor units (cents, pence and so on).
2. Set the **deposit percentage** (0 to 100, default 30). The deposit is the amount paid online to confirm the
   booking.
3. Optionally add **contract terms**. If terms are present, the client must sign them on the quote page before
   they can pay the deposit. Signatures record the name, time, IP address and browser, and the terms are
   fingerprinted, so changed terms do not match an earlier signature.
4. Optionally set a **payment schedule**: dated installments that split the balance after the deposit (up to 12).
   The amounts, in minor units, must add up to the balance exactly, and they must be listed in due-date order. The
   client then pays each installment by its own Stripe payment; the balance button is not shown. The schedule
   cannot change once the contract is signed or the deposit is paid.
5. Set the status and send the client the **public link** (`/quote/<token>` in the studio's language).

Quote statuses:

| Status | Meaning |
| --- | --- |
| Draft (staff only) | Not visible to the client. |
| Sent to client | The client can open the quote and pay. |
| Deposit paid | The deposit has arrived, through a verified Stripe webhook. |
| Paid in full | The balance has arrived, through a verified Stripe webhook. |
| Cancelled | Closed; the client can no longer pay. |

Important rules:

- A quote is marked deposit paid or paid in full **only** when the payment webhook confirms it. Staff cannot set
  these by hand.
- A paid quote cannot change status. Create a new quote instead.
- The client's invoice page shows the line items, totals, deposit and balance paid, amount due and confirmed
  payments. Clients can download the quote and the invoice as PDF files from their private links.

## Payments

Payments are recorded under **Sales > Payments** and created by the online payment flow. Each payment has:

- **Kind:** Deposit, Balance, Installment (with its number in the quote's schedule) or Ticket.
- **Status:** Waiting for payment, Paid, Failed (amount or currency did not match) or Expired (not paid in time).

Stripe is switched off until `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` are set on the server. While they
are not set, no payment button is shown. No live payment has been run through the platform yet. See
[self-hosting.md](self-hosting.md) for the settings.

## Productions

A production starts from a paid quote. When the deposit arrives, a project is created and linked to the quote
(the **Quote** field is set automatically). Productions are under **Production > Projects**.

Each project has:

- **Status:** Planning, Confirmed, In production, Delivered or Closed. The sidebar shows the status and the
  **Shoot date**, which is the day the crew works.
- **Client:** the client user who can see the project under **Your productions** in the portal.
- **Crew:** people and their role. Crew see the projects they are on. A person cannot be booked on two projects
  on the same day.
- **Tasks:** a checklist with optional due dates. Crew can see them.
- **Call sheet:** a meeting point, notes for the crew, and a timed schedule (24-hour times such as `08:30`).
  Staff and crew can read it; clients cannot.
- **Internal notes:** visible to production staff only.

The **calendar** in the portal (`/portal/calendar`) shows productions by shoot date for each month. The link
**Download to your calendar app** gives a calendar file of the productions that person can see, from this month
for the next twelve months. Each production is an all-day event with its title, location and a tentative or
confirmed status. Notes, quotes and client details are never written into the file. The file is a snapshot:
download it again after the schedule changes.

Deleting a project is limited to studio administrators.

## Client summary

Open a client's user record (a user with the Client role in the studio) to see their **Quotes and productions**
below the account details. It lists their quotes, matched by the quote's client email, and their productions,
matched by the production's client. Each entry links to the record. You see only what your role lets you read:
quotes follow the quote rules, and productions are listed only to studio administrators and production
managers of that studio, as on the production's own page.

## Client galleries

Galleries are under **Client delivery > Galleries**. A gallery is delivered to the clients you list in it.

| Setting | What it does |
| --- | --- |
| Status | **Draft (only staff can see it)** or **Published to clients**. Clients see a gallery only once it is published. |
| Expires at | After this date clients can no longer open the gallery. Leave empty for no expiry. |
| Watermark text | Written on the preview copies clients and album viewers see. Originals are never changed. |
| Allow downloads | Lets clients download full-resolution originals and ZIP files. |
| Share by link | Anyone with the link can view web-size copies (never originals), and the album can be embedded. Turning it off revokes the link; turning it on again creates a new one. |

Photos are added under **Client delivery > Gallery photos**. ZIP files are built in the background.

### ZIP downloads

Clients request **Whole gallery** or **Favorites only** ZIP files. Each request is tracked:

| Status | Meaning |
| --- | --- |
| Queued | Waiting for the background job. |
| Processing | Being built. |
| Ready | The client can download the file. |
| Failed | Could not be built; the error is recorded on the request. |
| Expired | The file has been removed by the cleanup job. |

### Favorites and selections

Clients mark favorites in the gallery. The favorite count shows next to the **Favorites** tab. Favorites are
private to each client.

## Inquiries and website

- **Sales > Inquiries** holds messages from the public inquiry form, in the admin inbox. Once email sending is
  set up, each new one is also emailed to the contact address in *Site settings*; reply to that email to answer
  the visitor. Untick *Email this address when a website inquiry arrives* there to stop the emails.
- **Website > Pages** holds the public pages. Page titles and intros are translatable; untranslated text shows
  the English version.
- Services and site settings are also edited in the admin, for the content of the public site.
- Published pages are listed in the studio's `/sitemap.xml` in every language the studio offers, and `/robots.txt`
  points search engines to it. Client, guest and token pages (portal, quotes, invitations, tickets, vendor and
  waitlist links, shared albums) are kept out of search results. A studio needs its domain set on its tenant for
  these addresses to be absolute.

## Events and tickets

Events have guest lists, invitations and RSVPs, CSV import and export, QR check-in, vendors, seating and
organizer guest lists. Ticket types, registrations and the waitlist cover paid and free events, with sales
windows and 24-hour waitlist offers. Invitation emails and waitlist offers need an email account to send; until
one is set up, invitation links are copied by hand.

## Known limitations

- The quote PDF shows the balance after the deposit but not its payment schedule. The client sees the
  schedule on the quote page.
- No email sending yet, so invitations and waitlist offers are copied by hand.
- The empty gallery list for clients says photos appear there once published, not that an email is sent. When the
  email account is set up, the wording can go back to promising an email (`portal.noGalleries` in
  `src/i18n/dictionaries`, English and Spanish).
- Storage, email and video provider accounts are not set up yet; see [self-hosting.md](self-hosting.md) for the
  settings that are in use.
