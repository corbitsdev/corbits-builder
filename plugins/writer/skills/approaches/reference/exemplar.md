# Approaches exemplar

A compact example of the shape and tone, for a small gym's class booking
app, after the person chose. Match the shape; take every fact from the
project's own documents.

```markdown
## In short

- **Approach A, one web app with its own database**, is chosen: simplest to
  run and inside the $20 monthly budget.
- **Approach B, a booking form over the existing spreadsheet**, is set
  aside: quicker to build, but double-booking stays possible.
- The deciding trade-off is **a reliable roster against keeping the
  spreadsheet**.

## Chosen approach: One web app with its own database

You chose the app that keeps bookings in its own database because a full
class must refuse the next booking, which the spreadsheet cannot promise.

## Approach A: One web app with its own database

### How it works

One server holds classes, members and bookings in a small database and
serves the pages members and staff use. The timetable spreadsheet is
imported once; email confirmations go out through the gym's email service.

### Fit against the brief

Meets every success criterion: a full class refuses bookings at the moment
it fills, and staff open rosters with no copying. Stays within the hosting
budget and the phones-and-laptop bound in the constraints.

### Trade-offs

Rosters are exact and live. Staff stop editing the spreadsheet, so the
timetable changes in the app from now on.

### Risks

The one-off import can misread an unusual timetable row; the import shows
each class it created so staff can check them.

### Effort and cost

About two hours of agent time and a few dollars of inference. You spend
about half an hour reviewing and setting up the email account. Running
cost: about $10 a month.

## Approach B: Booking form over the existing spreadsheet

### How it works

A form writes each booking as a row in the gym's spreadsheet, and staff
keep reading rosters there.

### Fit against the brief

Meets mobile booking; misses "a full class accepts no further bookings",
because two people can book the last place at once.

### Trade-offs

Staff keep their spreadsheet. Double-booking and hand-built rosters remain.

### Risks

Concurrent bookings collide; spreadsheet edits can break the form.

### Effort and cost

About an hour of agent time. Running cost: nothing beyond the spreadsheet.

## Side by side

| Criteria                     | A: Own database                          | B: Spreadsheet form        |
| ---------------------------- | ---------------------------------------- | -------------------------- |
| Fit against success criteria | All met                                  | Full classes not enforced  |
| Effort to build              | About two hours                          | About one hour             |
| Risk                         | Low; import checked once                 | Medium; colliding bookings |
| Cost to run                  | About $10 a month                        | None                       |
| What it rules out            | Editing the timetable in the spreadsheet | A guaranteed roster        |

## Recommendation

Approach A. It is the only one that ends double-booking, the problem the
brief exists to solve.
```
