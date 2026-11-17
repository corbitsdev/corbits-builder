# Constraints exemplar

A compact example of the shape and tone, for a small gym's class booking
app. Match the shape; take every fact from the project's own documents.

```markdown
## In short

- A **hosted web app** members open on their phones; staff use it on the
  front-desk laptop.
- **About 300 members and four staff**; one gym, twelve classes a week.
- **Bookings and rosters live in the app**; payments stay in the gym's till.
- The first version runs for **under $20 a month** on one small server.

## Solution form

A hosted web app, because members book from their own phones and staff from
the desk laptop, and both need the same live roster (the brief). A phone app
is left out: it adds store review and installs for no feature the brief
needs. A desktop-only tool is left out because members book from home.

## Platforms and devices

Current phone browsers and the desk laptop's Chrome; no install for anyone.

## People and scale

About 300 members and four staff (your message). Staff already use email
and the till; members need only a browser.

## Data sources

The class timetable comes from the gym's current spreadsheet, imported once.
Bookings are created in the app and kept in its own database.

## Privacy and accessibility

Members see only their own bookings; staff see every roster. Names and
emails stay in the app's database. Screens meet WCAG 2.1 AA.

## Outside services and accounts

Email for booking confirmations, through a Resend account the gym creates.

## Budget and timeline

A few hours of agent time to build; under $20 a month to run (your budget).
No launch date was named.

## First version and later

First version: booking, cancelling, rosters and check-in. Later: payments
at booking and a waiting list, once the booking flow has run for a while.

## Assumptions

- One gym location.
- Members sign in with an emailed link instead of a password.
- Screens meet WCAG 2.1 AA, the level most public sites meet.
- Confirmations go through Resend, whose free tier covers the gym's volume.

## Open questions

1. Should a cancelled place go to the next member who asked for it? I
   recommend yes, offered by email for an hour.
```
