# Constraints: Daily Streak & Habit Tracker

## Experience & Layout Constraints

- **Single-screen architecture**: All daily check-ins, streak figures, and the 7-day history grid must fit on one primary screen without secondary route navigation.
- **Immediate check-in response**: Toggling a habit updates the streak counter and weekly progress summary within 100ms.
- **Responsive density**: Works cleanly at 360px mobile width and 1280px desktop width.

## Data & Technical Constraints

- **Deterministic streak calculation**: Streaks are computed in the user's local calendar date (YYYY-MM-DD) so midnight UTC shifts never break a streak early.
- **Seeded starter habits**: Ships with 4 realistic daily habits and 14 days of completion history so the screen is immediately meaningful on first open.
