# Product requirements exemplar

A compact excerpt of the shape and tone, for a small gym's class booking
app. A real document lists every requirement; take every fact from the
project's own documents.

```markdown
## In short

- The first version lets **members book, cancel and see their classes**,
  and **staff run rosters and check-in**.
- **14 must requirements**, each with an acceptance criterion.
- I decided **cancellation closes two hours before class**; correct it if
  your rule differs.

## Purpose

Give members a place they can trust to be theirs, and give staff a roster
that is right without copying.

## Users

- Members: find a class with space, book it, cancel it.
- Staff: see who is booked, mark who came, edit the timetable.

## Scope

Booking, cancelling, rosters, check-in, timetable editing, the one-off
timetable import and email confirmations.

## Non-goals

- Payments at booking: they stay at the till for now (the constraints).
- A waiting list: later, once booking has run a while (the constraints).

## Functional requirements

- FR-1: A member books a place in a class that has space. Must. The brief.
- FR-2: A class at capacity refuses further bookings and shows "Full".
  Must. The brief's success criteria.
- FR-3: A member cancels a booking until two hours before the class. Must.
  My judgement; see Assumptions.
- FR-4: A member sees their upcoming bookings, soonest first. Must. My
  judgement: the first thing a member checks.

## Non-functional requirements

- NFR-1: Every screen meets WCAG 2.1 AA. Must. The constraints.
- NFR-2: A member sees only their own bookings. Must. The constraints.

## Interface requirements

- IR-1: Timetable screen: the week's classes with places left. Must. The
  brief.
- IR-2: Email service: sends a confirmation per booking. Must. The chosen
  approach.
- IR-3: Timetable import: reads the gym's spreadsheet (.xlsx, one row per
  class). Must. The constraints.

## Acceptance criteria

- AC-1 (FR-1): On the timetable, a member books a class with space and it
  appears in their bookings.
- AC-2 (FR-2): When a class reaches capacity, its Book button is replaced
  by "Full".
- AC-3 (FR-3): Inside two hours of the class, Cancel is unavailable and
  says why.

## Assumptions

- Cancellation closes two hours before class.

## Sources

Problem brief, constraints, approaches (Approach A chosen).
```
