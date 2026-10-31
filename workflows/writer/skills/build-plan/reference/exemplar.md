# Build plan exemplar

A compact excerpt of the shape and tone, for a small gym's class booking
app. A real plan covers every requirement; take every fact from the
project's own documents and the instruction's stack.

```markdown
## In short

- **Approach A on the default stack**: one server with its own database
  serving the member and staff screens.
- **Four phases**, each ending in something a person can try.
- The riskiest part is **the timetable import**; the fallback is entering
  classes by hand on the timetable screen.

## Approach and stack

Approach A, chosen in the approaches document, on the starter's stack: a
server with a small database and a React client. It holds bookings in one
place, which a full class refusing the next booking needs (FR-2), and runs
on one small server inside the budget (the constraints).

## Components and interfaces

- Server: classes, members and bookings tables; routes `GET /api/classes`,
  `POST /api/bookings`, `DELETE /api/bookings/:id`, `GET /api/rosters/:classId`.
- Client: Timetable, My bookings, Roster and Import screens.
- Email: a confirmation per booking through the gym's email service (IR-2).

## Data flow

The timetable arrives once from the gym's .xlsx through the Import screen
into the classes table (IR-3). A booking goes from the Timetable screen to
`POST /api/bookings`, which checks capacity inside one transaction (FR-2)
and sends the confirmation email (IR-2). Rosters read the bookings table.

## Phases

1. Data and import: `server/db/schema.ts`, `server/routes/import.ts`,
   `client/src/pages/import.tsx`. Delivers IR-3. Exit: importing the sample
   timetable lists every class with its capacity.
2. Booking: `server/routes/bookings.ts`, `client/src/pages/timetable.tsx`,
   `client/src/pages/my-bookings.tsx`. Delivers FR-1, FR-2, FR-3, FR-4,
   IR-1. Exit: a member books, sees and cancels a class; a full class shows
   "Full".
3. Staff: `client/src/pages/roster.tsx`. Delivers the roster and check-in
   requirements. Exit: staff mark attendance on a roster.
4. Email and polish: confirmation email (IR-2), accessibility pass (NFR-1).
   Exit: a booking sends one email; check-app passes.

## Install and run

Install with the starter's install script and start it with its dev
script; the app reads its port from the environment.

## Test plan

check-app after each phase. Each acceptance criterion is tried in the
running app on the screen the checklist names.

## Risks and unknowns

- An unusual timetable row fails to import. Fallback: the import lists
  skipped rows and staff add those classes by hand.
- Two members book the last place at once. Fallback: the capacity check
  and insert share one transaction, so the second booking is refused.

## Acceptance checklist

- [ ] AC-1: On Timetable, a member books a class with space; it appears on
      My bookings.
- [ ] AC-2: On Timetable, a class at capacity shows "Full" in place of
      Book.
- [ ] AC-3: On My bookings, inside two hours of the class, Cancel is
      unavailable and says why.
```
