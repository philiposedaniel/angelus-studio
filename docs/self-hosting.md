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

Never commit real values. Keep them in Coolify's environment settings.

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
| Email (event invitations, tickets, waitlist offers) | Off until `SMTP_HOST` and `EMAIL_FROM_ADDRESS` are set. Staff copy links by hand | An email service with SMTP (Resend, Postmark or similar) and a verified sending domain. Other notices (inquiries, gallery links, vendors) are not built yet. |
| Off-site file storage (Cloudflare R2) | Not used. Files are on the server's volumes | A Cloudflare account and R2 bucket. |
| Contract signature | Typed name with IP and fingerprint, no third-party service | A decision on an e-signature provider. |

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
