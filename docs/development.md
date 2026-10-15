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

Open http://localhost:3000/admin and create the first account. The first account created
through the admin screen becomes the **Super Administrator**. Later accounts are created by
administrators and default to the Client role.

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

## Health check

`GET /healthz` returns `{"status":"ok"}` when the app can reach the database, otherwise 503.
