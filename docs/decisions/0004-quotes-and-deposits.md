# 0004: Quotes and online deposits

Date: 2026-10-15. Status: accepted for the MVP. This is phase 4 of the MVP order in the platform
analysis (inquiry to paid booking).

- A **quote** is a priced offer for one client: line items in minor units (cents), a currency
  and a deposit percentage. Totals are calculated on the server and never accepted from a request.
- The client opens the quote from a private link (`/<language>/quote/<token>`). The token is 24
  random bytes, set when the quote is created and kept when it changes. The link works only while
  the quote is *sent* and not expired.
- **Payment** goes through Stripe Checkout, for the deposit only. The balance and contract
  signing are later work.
- A quote becomes **deposit paid** only from a verified, idempotent Stripe webhook
  (`src/lib/stripeWebhook.ts`). The amount and currency must match the quote, or the payment is
  recorded as failed and the quote does not change. Staff cannot set a quote to paid.
- Payment is off until `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` are set. Without them the
  page says online payment is not available; it shows no button.

Known limits (see `docs/development.md`): one Checkout session is created per click, so a client
who pays twice is charged twice and refunds are made in the Stripe dashboard; quote text is entered
once and is not translated; no email is sent yet, so staff copy the link into their own email.
