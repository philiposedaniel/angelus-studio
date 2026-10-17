# Events: staff manual

How studio staff run events in the admin (`/admin`): private events with invitations, public events
with tickets, and everything around them. Technical details and limits are in
[`docs/development.md`](../development.md); this manual is about doing the work.

## Who can do what

| Task | Studio administrator | Production manager | Finance manager | Editor |
|---|---|---|---|---|
| Create and edit events, invitation design | yes | yes | | yes |
| Guest lists, seating, check-in | yes | yes | | |
| Vendors and vendor bookings | yes | yes | | |
| Ticket types, registrations, waitlist, promo codes | yes | yes | | |
| Attendee list download | yes | yes | | |
| See payments, refund tickets | yes | | yes | |

Everything is per studio: staff only ever see their own studio's events, guests and money.
Clients can be named as an event's **organizers**, who then manage that event's guest list from
the client portal (see the [client guide](events-client-guide.md)).

## 1. Create the event

1. *Events → Events → Create new*. Fill in the title, the start (and end if known), the **time
   zone** of the venue, the location and a short summary. Times are always shown in the event's
   own time zone.
2. Decide who can find it:
   - **Public event** (open day, workshop, screening): leave *Show on the website* ticked. It
     appears on `/<language>/events` once published.
   - **Private event** (wedding, corporate party): untick *Show on the website*. It opens only
     through personal invitation and guest links.
3. Optional: a Vimeo or YouTube live link, and an *Album* (a client gallery, published with
   *Share link* on) for guests to see the photos afterwards.
4. Tick *Published* when it is ready. An unpublished event shows nothing to anyone outside the
   studio, and its invitation and ticket links stop working.

Translate the title, summary and invitation text with the language switch at the top of the
editor when the studio offers more than one language.

## 2. Private events: invitations and RSVP

1. **Design the invitation** in the event's *Invitation design* section: style, cover picture,
   headline, message, programme, dress code, map link. *Preview the invitation* shows it with a
   sample guest.
2. **Add guests**: one by one under *Events → Guests*, or in bulk with *Import guests from a
   spreadsheet* on the event (a CSV with a Name column; Email, Phone, Group, Party size and
   Language are optional). The import shows a preview first and skips emails already on the list.
3. **Send the invitations**: each guest has a personal *Invitation link*. Copy it from the guest
   and send it by email, WhatsApp or text. (Sending email from the platform comes once the email
   account is set up.)
4. **Follow the answers** in the event's *Invitations and RSVP* section: attending, people
   coming, declined, not answered. Record an answer given by phone by setting *RSVP* on the
   guest. Close replies with *Guests can reply* or a *Reply by* date.
5. **Seat people** under *Events → Tables*, then choose each guest's *Table* (or select several
   in the guest list and use *Edit*). The *Seating* section flags tables over capacity and guests
   without a table.
6. **Hand it to the host** if they want to manage guests themselves: add them to *Organizers* on
   the event. They see and change the guest list in their portal, never staff notes.
7. **Download the guest list (CSV)** at any time for the caterer or the printer.

## 3. Public events: tickets

1. **Add ticket types** under *Events → Ticket types*: name, price per place (in cents: 2500 is
   25.00; 0 is free), currency, number of places, the most places one person can book, and
   optional opening and closing times. Untick *On sale* to pause a ticket.
   - Paid tickets go on sale only once Stripe is set up; until then the page shows them as not
     available.
   - Once someone has registered, a ticket's price cannot change. Add a new ticket type instead.
2. **Promo codes** (optional) under *Events → Promo codes*: the code people type (any case
   works), a percentage off or an amount off each place, and optionally which tickets, which
   dates, and how many places in total. A 100% code makes the places free. Untick *Active* to stop
   a code; a code that has been used cannot be deleted.
3. **Watch sales** in the event's *Registration and tickets* section: places taken, left, checked
   in and on the waitlist per ticket type. Everyone registered is under *Events → Registrations*.
4. **Phone bookings**: create a registration by hand under *Events → Registrations*. It counts
   against the places like any other.
5. **Sold out**: the event page offers a waitlist automatically. When places free up they are
   offered to the people waiting in the order they joined, and held for them for 24 hours. You
   can take someone off the list under *Events → Waitlist* (*Removed by staff*), but you cannot
   hand places to someone out of turn. To let more people in, raise the ticket's places: the new
   places go to the waitlist first.
6. **Cancel a registration** by setting its status to *Cancelled*. The ticket stops working at the
   door and the places go back on sale (or to the waitlist). Once a registration has a price, its
   places and ticket cannot be changed; cancel it and add a new one.
7. **Refund a paid ticket** (administrators and finance managers): open the registration,
   *Payment → Refund … and cancel*, then *Yes, refund*. Stripe returns the full amount to the
   buyer and the registration is cancelled at once. The payment shows *Refund requested* until
   Stripe confirms it, then *Refunded*. For a partial refund, refund in the Stripe dashboard; the
   payment records the amount.
8. **Download the attendee list (CSV)** from the event's *Registration and tickets* section.

People who lose their ticket or waitlist link: open their registration or waitlist entry and
copy the link shown there to send it again.

## 4. Vendors

1. Keep the studio's suppliers under *Events → Vendors* (contact details, category, staff notes).
2. Book one for an event under *Events → Event vendors*: role, arrival time, instructions, status,
   agreed fee, amount paid and due date (in cents).
3. Send the booking's private *Vendor link*. The vendor sees the event, their arrival time and
   instructions, and confirms with a note. They never see amounts or staff notes.
4. The event's vendor section shows arrival times and what is still to pay.

## 5. On the day: check-in

1. On the phone that will scan, sign in to the studio's website (the same browser the camera
   app opens links in).
2. Scan the code on the guest's invitation or the buyer's ticket with the camera app. The page
   shows the name, party size or places, and for guests their table and dietary notes.
3. Choose how many have arrived and press *Check in*. Choosing 0 undoes it.
4. A cancelled registration shows **"Do not admit"**. Anyone not signed in as staff who opens a
   code only sees "Show this code at the entrance".

## 6. Before the event: a checklist

- Event published, in the right time zone, with location and live link if any.
- Invitations sent and replies closed, or tickets on sale with the right closing time.
- Tables seated; guest list and attendee list downloaded for the venue.
- Vendors confirmed through their links, arrival times set.
- At least one staff phone signed in for check-in, tested on one code.
- Album shared, if guests will see photos afterwards.

## Troubleshooting

| Problem | What to check |
|---|---|
| A link shows nothing (404) | The event is unpublished, or the link is opened on another studio's site. |
| A paid ticket shows "Not available" | Stripe is not set up yet (both keys are needed). |
| "Sold out" but places look free | People are on the waitlist or have places offered to them; those places are theirs first. |
| A buyer paid but has no entry code | Stripe has not confirmed the payment yet; refresh the ticket page in a minute. Check *Sales → Payments*. |
| The refund button is missing | Only administrators and finance managers see it, and only for a registration paid online. |
| Check-in page says "Show this code at the entrance" | The phone is not signed in as staff on this studio's site. |
| A promo code is refused | It is inactive, outside its dates, for other tickets, used up, or the ticket is free. |
