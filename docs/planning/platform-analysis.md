# Angelus Media Productions: Platform Analysis and Recommended Approach

Review of the "Master Prompt" (prepared with ChatGPT), 2026-10-15.

## 1. Verdict in one paragraph

The master prompt is a strong **requirements specification**: it is security-aware (deny-by-default authorization, signed URLs, idempotent webhooks, no mock payments, RAID is not backup) and its stack is sensible and mainstream. Its weaknesses are **scope** and **form**. It describes five products, roughly 55 database entities, 34 public pages and 11 phases, which is several years of work for a traditional team, and it is written as one giant prompt. An AI model given all of it at once will produce shallow coverage of everything. The way to succeed is to keep this document as the reference spec, cut a much smaller first release that earns money, and build it in small, tested, reviewed vertical slices.

## 2. What the prompt gets right (keep these)

- **Modular monolith** in one Next.js + TypeScript codebase. Correct for a one-company platform.
- **PostgreSQL + Redis + background workers**, with heavy work (image processing, ZIPs, video) kept out of web requests.
- **Private object storage + short-lived signed URLs**, never public original files.
- **External streaming providers** instead of building a video CDN.
- **Stripe Checkout with verified, idempotent webhooks**; money in integer minor units.
- **Server-side, resource-level authorization** with tests that try cross-client access.
- **Self-hosting on your own server with Docker + Coolify + Cloudflare**, separate environments, off-site encrypted backups.
- **Part 26 coding rules.** These are good and should become the repository's `CLAUDE.md`.

## 3. The biggest risks

| Risk | Why it matters | Recommendation |
|---|---|---|
| Scope | Five platforms at once means none is finished. Part 26 rule 23 already says "prefer complete vertical features". | Ship an MVP (section 6) and add modules only after it is in real use. |
| Multi-tenancy ("Organizations", "tenant isolation") | Building for many companies (SaaS) roughly doubles the authorization and data-model work. | If this platform is only for Angelus, drop tenant isolation. Clients and their companies are CRM records, not tenants. **Decision needed.** |
| Building a full CMS and admin from scratch | Page builder, menus, SEO fields, media library, drafts, versions and an admin UI for ~50 entities is a huge amount of UI. | Use **Payload CMS** (open source, runs inside Next.js, Postgres, self-hosted). It gives the admin panel, CMS, media library, drafts/versions, roles and access control out of the box. See section 4. |
| Auth.js gaps | Auth.js does not ship email+password flows, MFA or password reset in a finished form for the credentials provider; you assemble them yourself, which is where security bugs appear. | Use Payload's built-in auth for staff/admin, or **Better Auth** (self-hosted, TypeScript, has 2FA, passkeys, email verification). Verify current versions before choosing. |
| Video and livestream ambitions | Timecoded review, private VOD and private live are each products of their own (Frame.io, Vimeo, Mux). | Phase 1: YouTube/Vimeo embeds for public work. Later: **Mux** or **Cloudflare Stream** for private playback and live, with signed tokens. |
| Legal content | Privacy, terms, licensing, refund policies and binding e-signatures need a lawyer for your jurisdiction. AI can draft, not validate. | Have a lawyer review before launch. |
| Storage cost | Wedding and event galleries grow by terabytes. | Use **Cloudflare R2** (no egress fees, good for client downloads), set retention per gallery, and archive old originals to cheaper cold storage. |

## 4. Recommended architecture adjustments

**Application**
- **Next.js (App Router) + TypeScript strict + Tailwind + shadcn/ui**: keep.
- **Payload CMS 3** inside the same Next.js app as the CMS and back-office. Use its collections for content (pages, services, portfolio, blog, testimonials, FAQs, menus, settings) and for straightforward business records (clients, staff, equipment). Write custom code for workflows (booking state machine, galleries, payments).
- **Data layer decision:** Payload uses its own Postgres adapter (Drizzle). Running Prisma alongside it on the same database is messy. Recommended: use Payload's data layer only, and drop Prisma. Alternative: keep Prisma and limit the CMS to a simpler block-based page system you build yourself (slower). **Decision needed.**
- **Separate worker process** from the same repository (same code, different container) running BullMQ jobs: thumbnails, watermarks, ZIP builds, emails, reminders, webhook follow-ups. Simplification option: **pg-boss** (jobs in Postgres) removes Redis entirely at your scale.

**Media (your top priority)**
- Browser uploads go **directly to R2/S3 with presigned multipart uploads** (Uppy is a good client), never through the Next.js server. Resumable, retryable, large-file safe.
- Worker generates derivatives with Sharp (thumbnail, web sizes, watermarked preview) in WebP/AVIF + JPEG fallback; original stays untouched. Option: a self-hosted **imgproxy** container to resize on demand with signed URLs, reducing stored copies.
- Every view or download goes through an authorization check that then issues a short-lived signed URL.
- ZIP downloads: a worker streams the ZIP into a private temporary object, notifies the client, and the object expires automatically.
- Checksums (SHA-256) at upload for duplicate detection and integrity.

**Scheduling and conflicts**
- Use **PostgreSQL exclusion constraints** (`tstzrange` + `btree_gist`) on staff and equipment reservations, so the database itself refuses double-booking. This is more reliable than application-only checks.

**Integrations**
- Payments: Stripe Checkout + webhooks (plus Stripe Tax if you sell across tax regions).
- E-signature: **Documenso** (open source, self-hostable) fits your ownership goal; Dropbox Sign or DocuSign as hosted alternatives.
- Email: provider-agnostic interface with **Postmark, Resend or Amazon SES**; templates in React Email. Separate marketing (newsletter tool) from transactional email.
- Analytics: privacy-friendly and self-hostable (**Umami** or **Plausible**), avoiding a cookie banner burden.

**Hosting**
- Your server spec (8 to 16 cores, 64 GB RAM, mirrored NVMe) is more than enough for years. Run production and staging there; development runs locally or in the cloud.
- Postgres backups with **pgBackRest or WAL-G** to off-site storage at a **different provider** than your media. Test restores on a schedule.
- Monitoring: **Uptime Kuma** (uptime), **Sentry or self-hosted GlitchTip** (errors), Coolify's metrics, later Grafana if needed.
- Only ports 80/443 (via Cloudflare) and SSH (key-only, ideally behind Cloudflare Tunnel or Tailscale) open; Postgres and Redis on the internal Docker network only.

## 5. Build vs. buy, honestly

Mature products already exist for each module: Pic-Time, Pixieset and ShootProof (galleries and proofing), HoneyBook and Dubsado (booking, contracts, invoices), Frame.io (video review), Zola and Greenvelope (invitations). Building your own makes sense where it creates a **unified, branded client experience and data you own**, which is a valid reason. It makes less sense for commodity pieces. Suggested split:

- **Build:** website + CMS, client portal, photo library and delivery, events/guest portal, booking and quotes, production tracking.
- **Integrate, don't build:** payments (Stripe), video streaming/live (Mux, Cloudflare Stream, YouTube), e-signature (Documenso), email delivery, print fulfillment (a lab's API, later).
- **Defer:** album designer, print store, AI tagging, moderated chat, lower-thirds management, advanced analytics.

## 6. Recommended MVP and phase order

The original 11 phases put revenue (booking and payments) at phase 7. Reorder so that each release is usable by real clients.

1. **Foundation** (repo, CI, Docker, Payload/Next.js, auth with admin MFA, roles, staging deploy on your server).
2. **Public website + CMS**: home, about, services, packages, portfolio, contact, inquiry form, legal pages, SEO. *Launchable on its own; replaces any current site.*
3. **Client portal + photo delivery**: client accounts, private galleries, uploads, derivatives, favorites/selections, secure downloads, ZIPs, share links. *Your stated top priority, and the strongest differentiator.*
4. **Inquiry to paid booking**: services/packages, quote builder, PDF quote/invoice, Stripe deposits and balances, contract signing, booking calendar, email notifications.
5. **Events + guest access**: event pages, private event galleries for guests, livestream embed per event.
6. **Production management**: projects, stages, tasks, staff, equipment reservations with conflict prevention.
7. **Invitations and RSVP**: templates, guest lists, CSV import, RSVP, QR check-in.
8. **Video**: private video delivery via Mux/Cloudflare Stream, versions, timecoded review, private live.
9. **Advanced**: album design, print ordering, analytics, AI tagging.

Hardening (security review, accessibility, load tests, restore drills) happens **at the end of every phase**, not only in a final phase.

## 7. How to develop it entirely with AI

You can, but treat the AI as a fast engineering team that you direct and review, not as a one-shot generator.

1. **Turn the master prompt into a repository**, not a prompt: `docs/requirements/` (the master prompt split by part), `docs/decisions/` (one short record per decision), and `CLAUDE.md` with the Part 26 rules plus the project's conventions. The AI reads these when it needs them.
2. **One vertical slice per task**, sized so it fits in a single reviewable pull request: for example "client can mark favorites in a gallery, with tests". In this Project, that is one thread per feature.
3. **Every change goes through a pull request** with CI running lint, type-check, unit and integration tests, and Playwright end-to-end tests. You (or a reviewer) look at a staging deployment before merging.
4. **Write the authorization tests first.** A central policy function (`can(user, action, resource)`) plus a test suite that tries cross-client access, expired links and download bypasses. This protects you from the most dangerous class of AI-written bugs.
5. **Keep humans in charge of:** business rules and pricing, brand and visual approval, legal text, secrets and accounts, production deploys and data deletion, and a security review before launch (consider a paid external review before taking real client data at scale).
6. **Things AI cannot do for you:** create and verify accounts (GitHub, Stripe, Cloudflare, R2, email provider, Mux), buy and provision the server, provide your real photos, videos and copy, and supply legal review.

## 8. Decisions needed from you

Each can be answered in a word or two.

1. **Who uses it?** Only Angelus (recommended) / SaaS for other studios later.
2. **CMS and admin foundation:** Payload CMS (recommended) / custom admin with Prisma.
3. **Languages:** English only / multilingual (which languages?). The prompt does not mention this and it affects every page.
4. **Country, currency and tax:** where you operate and invoice (affects tax, legal pages, Stripe setup).
5. **Booking style:** inquiry and quote first (recommended) / instant online booking for fixed packages.
6. **Expected media volume:** roughly how many TB per year, and how long galleries stay available.
7. **Existing website or client data to migrate:** yes / no.
8. **Domain and brand assets:** do you have the domain, logo and brand fonts ready?

## 9. What is needed before building starts

Nothing can be scaffolded from this Project yet, because no repository or device folder is connected. Either:

- **Connect GitHub** at https://claude.ai/connect-github and create (or let Claude create) a private repository. Recommended: it gives you pull requests, CI and a clean history, and it is how Coolify deploys to your server.
- **Or allow access to a folder on your computer**, where code is written locally and you push it yourself.
