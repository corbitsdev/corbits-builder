# Build Plan: Daily Streak & Habit Tracker

## Architecture & Stack

- **Frontend**: React 19, Vite, Tailwind CSS, `@corbits/react-ui` components (`Card`, `Button`, `Badge`, `Dialog`, `Input`, `Checkbox`).
- **Backend**: Bun + Hono REST API with SQLite (`bun:sqlite` + Drizzle ORM).

## Vertical Slices

1. **Schema & Seed**: `habits` and `habit_completions` tables seeded with 4 habits and 14 days of history.
2. **API Endpoints**: `GET /api/habits?date=YYYY-MM-DD`, `POST /api/habits`, `POST /api/habits/:id/toggle`.
3. **Today Screen**: Summary stat cards, filter bar, interactive habit rows with 7-day dots, and New Habit dialog.

## Acceptance Checklist

- [ ] Summary cards show completed today count, completion rate, and longest current streak.
- [ ] Toggling a habit updates its check-in state and streak count immediately.
- [ ] Creating a new habit adds it to the list with a 0-day streak.
