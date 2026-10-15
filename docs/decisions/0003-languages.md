# 0003: Languages

Date: 2026-10-15. Status: accepted (Daniel: "First English, followed by all other languages;
this also encompasses the tenant's interests").

- English is the default language and the fallback for anything not yet translated.
- The platform supports a list of languages in `src/i18n/config.ts` (currently English,
  Spanish, French, Portuguese, German, Italian). Adding one is a one-line change there.
- Each studio chooses which of those languages its website offers (`tenants.languages`) and
  its default (`tenants.defaultLocale`).
- Public URLs carry the language: `/en`, `/es`, ... Visitors without one are redirected using
  their browser's preferred language; a language the studio does not offer redirects to the
  studio's best alternative.
- CMS content is translated per field in the admin (localized fields). Interface text lives in
  `src/i18n/dictionaries`; languages without a dictionary show English interface text.
- Right-to-left languages (Arabic, Hebrew) need layout work before they are added.
