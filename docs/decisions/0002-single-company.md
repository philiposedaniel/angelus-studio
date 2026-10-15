# 0002: Single company, no multi-tenancy (assumed)

Date: 2026-10-15. Status: assumed, awaiting confirmation from Daniel.

The platform serves Angelus Media Productions only. Client companies are CRM records, not
tenants, so there is no organization-level data isolation layer. Isolation between clients is
enforced by resource-level access rules (a client only sees their own projects, galleries and
bookings). Revisit only if the platform is ever offered to other studios.
