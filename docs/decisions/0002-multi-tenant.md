# 0002: Multi-tenant from the start

Date: 2026-10-15. Status: accepted (Daniel: "Multi-tenancy, building SaaS later").

## Context
The platform is built for Angelus Media Productions first, but may later be offered to other
studios as a service. Adding tenant isolation after the data model has grown is expensive and risky.

## Decision
Every studio is a `tenants` document. Studio-owned collections (`media`, `services`,
`site-settings`, and every business collection added later) carry a `tenant` field via the
official `@payloadcms/plugin-multi-tenant` plugin.

Two role levels:
- Platform role on the user: `super-admin` (operates every studio) or `user`.
- Studio roles on each membership (`users.tenants[].roles`): admin, production manager,
  photographer, videographer, editor, finance manager, event organizer, client.

Rules: studio admins manage members of their own studios only and can never change their own
memberships; only super admins create studios, grant platform roles or delete accounts; only
the account owner (or a super admin) changes sign-in details. Public pages resolve the studio
from the request host name (`tenants.domain`), falling back to `DEFAULT_TENANT_SLUG`.

## Consequences
- Every new studio-owned collection must be registered with the plugin in `payload.config.ts`
  and get cross-studio tests in `tests/int`.
- Slugs are unique per studio, not globally (`src/hooks/uniqueSlugPerTenant.ts`).
- Billing, studio sign-up and custom-domain automation are not built yet; they belong to the SaaS phase.
