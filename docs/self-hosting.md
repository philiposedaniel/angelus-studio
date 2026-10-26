# Self-hosting and operations

How the platform runs on the studio's own server, what it needs, and what is still switched off
waiting on an account. Local development is in `docs/development.md`.

## What runs

`docker-compose.prod.yml` is the production stack, deployed through Coolify:

- **app**: the Next.js and Payload image built from `Dockerfile`. It serves the website, the
  client portal, the admin, the API and the background jobs, all in one process. Port 3000.
- **postgres**: PostgreSQL 17, reachable only on the internal Docker network.

Three volumes hold all the state. Back up all three:

| Volume | Holds | Notes |
| --- | --- | --- |
| `pgdata` | Every record: studios, clients, quotes, payments, events, guests | The database. |
| `media` (`/app/media`) | Public website images and video | Served to everyone. |
| `private-media` (`/app/private-media`) | Client gallery photos and original files | Never served from a public path; the app checks each request. |

## Environment variables

| Name | Required | Notes |
| --- | --- | --- |
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | Yes | Used by the postgres container. `POSTGRES_DB` defaults to `angelus`. |
| `DATABASE_URL` | Set by compose | Built from the three values above. Set it yourself only when using an external database. |
| `PAYLOAD_SECRET` | Yes | Signs sessions. A long random value (`openssl rand -hex 32`), different per environment. Changing it signs everyone out. |
| `NEXT_PUBLIC_SERVER_URL` | Yes | Public address, such as `https://studio.example`. It is baked into the build, so **changing it needs a rebuild**, not just a restart. |
| `DEFAULT_TENANT_SLUG` | Recommended | Studio shown when the host name matches no studio domain. |
| `PRIVATE_MEDIA_DIR` | No | Defaults to `/app/private-media` in the image, which is the mounted volume. |
| `PAYLOAD_JOBS_AUTORUN` | No | Set to `false` on any extra app instance so only one runs background jobs. |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | No | Both are needed for online deposits. Until both are set, payment stays off. |
| `EMAIL_MODE` | No | `smtp` (the default once SMTP is set), `log` or `off`. See *Email* below. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `EMAIL_FROM_ADDRESS`, `EMAIL_FROM_NAME` | No | The email service. See *Email* below. |
| `S3_BUCKET`, `S3_REGION`, `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE` | No | Private object storage for client photos. See *Object storage for client photos* below. |
| `PAYLOAD_DB_PUSH` | No | Leave unset. Outside production the schema is pushed on start unless this is `false`. Production always runs the committed migrations. |

What unset means, in short: no email is sent or logged, no payment is taken, client photos stay on the `private-media` volume, and each app instance runs background jobs (set `PAYLOAD_JOBS_AUTORUN=false` on extra instances).

Never commit real values. Keep them in Coolify's environment settings.

## Email

Email is chosen by `EMAIL_MODE` and the SMTP variables:

| Mode | When | What happens |
| --- | --- | --- |
| `smtp` | `SMTP_HOST` and `EMAIL_FROM_ADDRESS` are set, and `EMAIL_MODE` is unset or `smtp` | Each message is sent through the email service in a background job. A send that fails is tried again up to three times. |
| `log` | `EMAIL_MODE=log`, with or without SMTP | Each message is written to the app log in full and nothing is sent. The log holds live share links, so use `log` only on a development or preview server, never on the studio's live server. |
| `off` | Neither SMTP setting is complete (the default), or `EMAIL_MODE=off` | Nothing is sent or logged. Staff copy invitation and ticket links by hand. |

Paste these into Coolify once the account exists. Values come from the email service's SMTP page.

| Name | Example | Notes |
| --- | --- | --- |
| `SMTP_HOST` | the host the service gives | Required to send. Setting it alone does nothing: the sender address is also needed. |
| `SMTP_PORT` | `465` or `587` | Defaults to `587`. |
| `SMTP_SECURE` | `true` | Optional. `true` means TLS from the start (port 465); `false` means upgrade with STARTTLS. Unset, the port decides. |
| `SMTP_USER` | the login the service gives | Leave unset if the server needs no login. |
| `SMTP_PASSWORD` | the password or API key | A secret. Keep it in Coolify only. |
| `EMAIL_FROM_ADDRESS` | `events@your-domain.example` | Required to send. Must be on a domain verified with the service, or mail is refused or lands in spam. |
| `EMAIL_FROM_NAME` | `Angelus Media Productions` | Optional. Used for platform emails. Event emails use the studio's name. |

What is sent, and to whom:

| Email | Sent to | Sent when |
| --- | --- | --- |
| Invitation, reply reminder, day-before reminder | The guest | Staff send an invitation or reminder, or the day before a guest's event |
| Reply notice | The event's reply-notice recipients | A guest replies |
| Ticket and ticket day-before reminder | The ticket buyer | A ticket is bought, and the day before the event |
| Waitlist offer | The person offered a place | A place opens for someone on the waitlist |
| Vendor booking and confirmation | The vendor, and the event's reply-notice address | A vendor booking is made, and when it is confirmed |
| Inquiry alert | The studio's contact address | Someone sends the contact form (turned off in the site settings if not wanted) |

In `off` and `log` mode nothing is sent. Staff copy links by hand in `off` mode, whatever the email.
A message is written from the record when the job runs, and skipped if it no longer applies (for example
a guest who has already been invited).

**How to check once set.** Send an invitation to a guest whose address is yours, from the event's guest
list, then look for the message in your inbox. If it does not arrive, read the app log for the send error:
the job retries three times before it gives up. To see the full text without sending, set `EMAIL_MODE=log`,
redeploy, and send the same invitation. The log shows the subject, recipient and body. Then set `EMAIL_MODE`
back to unset.

Gallery-link emails are not built yet. Client gallery links are copied by hand.

## Not built yet: video and signatures

These two features have no code and read no environment variables in this release. Nothing needs
setting for them, and nothing they would need can be pasted yet. When one is built, its variables and
its check will be added to this section.

- **Private video hosting.** Video is not hosted by the platform yet. No provider has been chosen.
- **E-signature.** Contracts use a typed name with the signer's IP and a fingerprint.

## Database

- PostgreSQL 17, as in the compose file.
- Production applies committed migrations automatically when the app starts. Development pushes
  schema changes instead, and `NODE_ENV=production` turns that off.
- The database role that runs migrations must be able to create tables and indexes in the
  `public` schema. This is the default for the database owner.
- From the equipment reservations migration (`20261016_120136`, PR #21), the same role must also be
  allowed to `CREATE EXTENSION`, because the migration installs `btree_gist` to stop two bookings
  of the same kit from overlapping. `btree_gist` is a trusted extension, so a role that owns the
  database (or holds CREATE on it) can install it without being a superuser. The migration fails
  on a role without that right, so check before the first deploy that includes it.

## Deploying a release

1. Back up the database and the two file volumes.
2. Deploy the new image. Migrations run when the app starts.
3. Check `GET /healthz` returns `{"status":"ok"}`. Docker's health check also polls it. It returns
   503 when the database is unreachable.
4. Check the app logs for migration lines and errors.

A release that adds a migration cannot be undone by redeploying the old image, because the
database has already changed. Restore from the backup taken in step 1 if a release must be rolled
back.

## Background jobs

Jobs run inside the web process (Payload's job queue, stored in Postgres, no Redis). ZIP cleanup
runs hourly. Run exactly one app instance, or set `PAYLOAD_JOBS_AUTORUN=false` on the others.

## What is switched off, and the account it waits on

| Feature | State | Waiting on |
| --- | --- | --- |
| Online deposit and balance payment | Off until `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` are set | Stripe account and test keys. Live payment has never been run. |
| Email (invitations, tickets, waitlist, vendor and inquiry notices) | Off until `SMTP_HOST` and `EMAIL_FROM_ADDRESS` are set. Staff copy links by hand. See *Email* above. | An email service with SMTP (Resend, Postmark or similar) and a verified sending domain. Gallery-link emails are not built yet. |
| Private video hosting | Not built. No variables exist yet. | A video provider choice, and the feature built. |
| Contract signature | Typed name with IP and fingerprint, no third-party service. No variables. | A decision on an e-signature provider. |

## Backups

There are no automated backups yet. Until a backup job is in place, the studio owner must take
them: a database dump plus a copy of `media` and `private-media`, kept off the server. A restore
has not been rehearsed. Rehearse one before relying on it.

## Known limits

- No automated backups or restore test (above).
- Client IP addresses are stored with contract signatures, and there is no retention rule for
  them yet.
- No PDF copy of a signed contract is produced; the signed record is the database row.
- The app listens on port 3000. Put TLS in front of it with Coolify's proxy, and serve the public
  site over HTTPS only.

## Object storage for client photos

Gallery photos, their web copies and their thumbnails can be kept in a private bucket on any S3-compatible
service (Cloudflare R2, Amazon S3, MinIO). It is off until `S3_BUCKET` is set. Until then, photos stay on the
server's `private-media` volume, as before.

Set all of these together. A bucket set without the others stops the upload with a message naming the
missing variable. It never quietly falls back to the local disk.

| Name | Example | Notes |
| --- | --- | --- |
| `S3_BUCKET` | `studio-private` | A private bucket. Do not make it public: every download is a signed link. |
| `S3_REGION` | `us-east-1` | Required. Cloudflare R2 uses `auto`. |
| `S3_ENDPOINT` | `https://<account-id>.r2.cloudflarestorage.com` | Needed for R2 and other services. Leave unset for Amazon S3. |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | from the service | A secret. Give the key read, write and delete on this bucket only. |
| `S3_FORCE_PATH_STYLE` | `true` | Only for services that need it (MinIO). Leave unset otherwise. |

What happens with it on:

- **Uploads.** Payload writes the upload to the local folder first. The app then copies the original and its
  copies to the bucket and removes the local files. If a copy fails, the upload fails too, nothing is saved,
  and the photo can be uploaded again.
- **Downloads.** A client or a shared-album viewer gets a link to the stored file that lasts five minutes and is
  never cached, so a revoked share stops working on the next request. Watermarked copies are built by the app
  from the stored file, so the watermark is never skipped.
- **ZIP downloads** are built from the bucket. The ZIP itself stays on the local volume until it expires, as before.
- **Deleting a photo** or replacing its file removes the stored copies. If the bucket cannot be reached, the
  delete fails and the photo stays, rather than leaving files behind.

Limits:

- **Photos already on the local volume.** They are not read from the bucket. After setting the variables, run
  `pnpm storage:move-local`, once. The app image does not include the command-line tools, so run it from a
  checkout of the same release on the server (`pnpm install`, then the command), with the same database and S3
  variables, and with `PRIVATE_MEDIA_DIR` pointing at the photos volume. It copies each photo's original and copies
  into the bucket and removes the local files. It reports how many moved and how many were already stored, and
  running it again moves nothing. The Payload CLI sometimes exits without printing anything, so if the line
  `Gallery files moved to object storage` is missing from the output, run it again. Clients should not use the galleries until it has finished. Back up
  `private-media` first. This command has not yet been run on a server; the first run is a check to make.
- **Not yet tested against a live bucket.** The automated tests use an in-memory store and check the shape of
  the signed links. Check the first real setup yourself: upload one photo to a test gallery, confirm three
  objects appear under `gallery-photos/`, open a client's copy and see it load, then reopen the same link after
  five minutes and confirm the service refuses it.
