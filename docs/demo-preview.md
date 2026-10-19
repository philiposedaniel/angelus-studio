# Demo data and a preview server

A preview is a throwaway copy of the platform, filled with demo records, for clicking through
before anything real goes live. It needs its own empty database. Never point it at the
production database.

## What `pnpm seed:demo` creates

In the studio named by `DEFAULT_TENANT_SLUG` (default `angelus`):

- A **studio administrator**, `admin@<studio>.demo.test`, and a **client**,
  `client@<studio>.demo.test`, sharing one random password printed once at the end. Neither is a
  platform super administrator.
- A **gallery** of eight generated photos, published to the client, with downloads on, a
  share link, and a selection of up to five photos for the client to submit.
- A **quote** with three line items, a 30% deposit and a contract to sign.
- A **production** with crew, tasks and a call sheet.
- A **private wedding** with a garden invitation and five guests in different RSVP states; the
  client is its organizer, so it shows in their portal.
- A **public open day** with a free ticket, a sold-out workshop with a waitlist, a priced ticket
  and one confirmed registration.

It prints both sign-ins and a link to each page, using `NEXT_PUBLIC_SERVER_URL`.

Running it again changes nothing. It refuses any database that already has an account outside
`*.demo.test`, because it prints a password in the clear; that is the guard against running it on
real data. The command needs the source checkout (it uses `payload run`), so it does not run
inside the production image; the preview image below keeps the source for that.

## A preview with Docker (one command)

`docker-compose.preview.yml` runs the app with its own Postgres. On start it applies the
migrations, loads the demo data and serves the site. It never touches the production database or
volumes. From a clone of the repository on any machine with Docker, such as the studio server:

```bash
export PREVIEW_URL=https://preview.<your domain>   # the address people will open
export PAYLOAD_SECRET=$(openssl rand -hex 32)
docker compose -f docker-compose.preview.yml up -d --build
docker compose -f docker-compose.preview.yml logs app | grep -A12 'Demo data created'
```

The last line shows the two demo sign-ins and a link to each page. They are printed only on the
first start, so keep them. The app listens on port 3000; set `PREVIEW_PORT` to use another.
`PREVIEW_URL` is baked into the build, so change it with `--build`.

In Coolify, add the repository as a Docker Compose resource using `docker-compose.preview.yml`,
set `PREVIEW_URL` and `PAYLOAD_SECRET`, and give the `app` service a domain such as
`preview.<your domain>`. To start over with fresh demo data, remove the stack together with its
volumes (`docker compose -f docker-compose.preview.yml down -v`).

The preview image is larger than the production one and runs as root, because it carries the
full source and build tools. It is for demo data only; never point it at real data.

## A preview without Docker

From a clone of the repository, with Node.js 22, pnpm and a PostgreSQL database:

```bash
docker compose up -d postgres        # local Postgres from docker-compose.yml
cp .env.example .env                 # set PAYLOAD_SECRET (openssl rand -hex 32)
                                     # and NEXT_PUBLIC_SERVER_URL to the address people will open
pnpm install
pnpm migrate
pnpm seed:demo                       # note the password it prints
pnpm build
pnpm start                           # http://localhost:3000
```

`NEXT_PUBLIC_SERVER_URL` is baked into the build, so set it before `pnpm build`.

To let someone else open it, put it behind the server's reverse proxy (Coolify or Caddy) on a
subdomain such as `preview.<your domain>`, or run a temporary tunnel such as
`cloudflared tunnel --url http://localhost:3000`, which prints a public `trycloudflare.com`
address that stops working when the command stops.

## Known limits

- Payments stay off unless Stripe keys are set, so the priced ticket and the deposit show their
  amounts with no pay button. No email is sent.
- Demo dates are relative to the day the command runs: the open day is three weeks later, the
  wedding and its production about six weeks later.
- Claude's cloud workspace cannot publish a preview itself, because its network blocks tunnel
  services. A preview has to run on a machine you control.
