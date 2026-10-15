# 0001: Payload CMS as the admin and CMS foundation

Date: 2026-10-15. Status: accepted (chosen by Daniel).

## Context
The platform needs a CMS for the public site and a back office for roughly fifty business
entities. Building every admin screen and a page editor by hand would take months.

## Decision
Use Payload CMS 3 inside the Next.js application, with its PostgreSQL adapter as the data
layer. Prisma, proposed in the original master prompt, is not used, to avoid two ORMs on one database.

## Consequences
- Admin panel, CMS, media library, drafts, versions, auth and access control come built in.
- Business workflows (bookings, galleries, payments) are custom code on Payload collections,
  hooks and endpoints.
- Schema changes go through Payload migrations.
- Payload is open source (MIT) and self-hosted, so ownership of code and data is unchanged.
