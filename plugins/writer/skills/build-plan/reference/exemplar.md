# Build plan exemplar: a web app

A compact excerpt of the shape and tone, for a small gym's class booking
web app built on the coder's web starter. A real plan covers every
requirement; take every fact from the project's own documents and the stack
the project uses, the person asked for or you chose.

```markdown
## In short

- It runs on **one small server keeping its own data**, inside the budget
  you gave; it needs **the gym's email service account** to send
  confirmations.
- You can **click through the designed screens in the preview early**, on
  labelled sample data, before bookings are real.
- The riskiest part is **the timetable import**; the fallback is entering
  classes by hand on the timetable screen.

## Stack

The web starter's stack, a server that keeps its data as validated JSON files
and a React client, for the approach chosen in the product requirements (Approach). It holds
bookings in one place, which FR-2 needs, and runs on one small server
inside the budget (Bounds).

## Packages

- `xlsx@0.18.5` in server: reads the gym's timetable export (IR-3).
- `nodemailer@6.9.16` in server: sends the booking confirmation (IR-2).

## Components and interfaces

- Server: classes, members and bookings stores; routes `GET /api/classes`,
  `POST /api/bookings`, `DELETE /api/bookings/:id`, `GET /api/rosters/:classId`.
- Client: a page under `client/src/pages` for the Timetable screen (IR-1)
  and for My bookings, Roster and Import.
- Email: a confirmation per booking through the gym's email service (IR-2).

## Data flow

The timetable arrives once from the gym's .xlsx through the Import screen
into the classes store (IR-3). A booking goes from the Timetable screen to
`POST /api/bookings`, which checks capacity and saves the booking in one store update (FR-2)
and sends the confirmation email (IR-2). Rosters read the bookings store.

## Phases

1. Contract and sample data: `packages/shared/src/index.ts` (class, booking,
   roster schemas), `client/src/sample-data.tsx`. Exit: typecheck passes.
2. Theme and shell: `client/src/styles.css`, `client/src/components/layout.tsx`.
   Exit: the preview shows the designed header and navigation with the
   sample data note.
3. Screens on sample data: `client/src/pages/timetable.tsx`,
   `client/src/pages/my-bookings.tsx`, `client/src/pages/roster.tsx`,
   `client/src/pages/import.tsx`, each added to `client/src/routes.tsx` as it
   is written. Exit: each screen shows sample classes.
4. Server: `server/src/store.ts`, `server/src/routes/import.ts`,
   `server/src/routes/bookings.ts`, `server/src/routes/rosters.ts`,
   `server/src/routes/bookings.test.ts`. Delivers IR-3, FR-2. Exit: a
   booking for a full class is refused with a 4xx.
5. Wiring: `client/src/api.ts` reads `/api`; `client/src/sample-data.tsx` is
   deleted. Delivers FR-1, FR-3, FR-4, IR-1 and the roster and check-in
   requirements. Exit: a member books, sees and cancels a class; a full class
   shows "Full"; staff mark attendance on a roster; the sample data note is
   gone.
6. Email and polish: confirmation email (IR-2), accessibility pass (NFR-1).
   Exit: a booking sends one email; check-app passes.

## Install and run

Install with the starter's install script and start it with its dev
script; the app reads its port from the environment.

## Test plan

check-app after each phase. `server/src/routes/bookings.test.ts` books,
cancels and fills a class through the API, run by `bun test` in CHECKS.txt;
it proves AC-1 and AC-2. AC-3 is tried by hand on My bookings.

## Risks and unknowns

- An unusual timetable row fails to import. Fallback: the import lists
  skipped rows and staff add those classes by hand.
- Two members book the last place at once. Fallback: the capacity check
  and the save share one store update, so the second booking is refused.

## Acceptance checklist

- [ ] AC-1: `bookings.test.ts` books a class with space and lists it in My bookings.
- [ ] AC-2: `bookings.test.ts` books a class at capacity.
- [ ] AC-3: On My bookings, open a booking inside two hours of its class.
```
