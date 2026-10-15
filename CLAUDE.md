# Angelus Studio

Website and business platform for Angelus Media Productions: public website, client portal,
event and guest portal, production management and administration. Next.js (App Router) with
Payload CMS 3 running inside it, on PostgreSQL. Self-hosted on a dedicated Ubuntu server.

@AGENTS.md

## Read first

- `docs/planning/platform-analysis.md`: scope, MVP order and architecture choices.
- `docs/decisions/`: decisions already made. Do not reopen them without the owner.
- `docs/development.md`: local setup, commands and migrations.

## Layout

- `src/payload.config.ts`: collections, globals, database adapter.
- `src/collections/`, `src/globals/`: Payload schema. Every collection declares explicit access rules.
- `src/access/`: roles and access helpers. All authorization goes through here.
- `src/app/(frontend)/`: public website. `src/app/(payload)/`: generated admin and REST API (do not edit by hand).
- `src/migrations/`: committed database migrations.
- `tests/unit`, `tests/int` (Vitest, Local API against Postgres), `tests/e2e` (Playwright).

## Rules

1. Inspect the existing code before changing it; explain intent before large changes.
2. Use current stable dependencies; verify a package or API exists before relying on it.
3. TypeScript strict. No `any` without a reason in a comment.
4. Authorization is deny-by-default and enforced on the server. Every new collection, global,
   endpoint, server action and background job gets explicit access rules plus a test that tries
   to cross client boundaries. Never rely on hidden URLs or client-side checks.
5. Local API calls made on behalf of a user pass `user` and `overrideAccess: false`.
6. Never expose private originals through public URLs. Client deliverables will use private
   object storage and short-lived signed URLs; the `media` collection is public website media only.
7. Never hardcode secrets or commit `.env` files.
8. Schema changes ship as migrations: change the schema, run `pnpm migrate:create <name>`, commit it.
9. Money is stored in integer minor units. Payments are only confirmed by verified, idempotent webhooks.
10. No mock authentication, simulated payments or non-functional buttons presented as finished.
11. User-facing content should be editable in the CMS where practical.
12. Prefer finished, tested vertical slices over many half-built modules. Avoid unnecessary dependencies.
13. Run `pnpm lint`, `pnpm typecheck`, `pnpm test:int` and `pnpm build` before proposing a merge.
    Never claim a check passed unless it was actually run.
14. Do not touch production data or deploy to production without the owner's explicit approval.
15. Document configuration changes and known limitations in `docs/`.
