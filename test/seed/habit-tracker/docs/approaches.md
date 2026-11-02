# Approaches: Daily Streak & Habit Tracker

## Option 1: SQLite-Backed Daily Ledger (Recommended)

Store habits and normalized daily check-in rows (`habit_id`, `completed_on`) in SQLite via Drizzle, computing current and best streaks in a single query.

## Option 2: Browser-Only LocalStorage Store

Keep all habits and completion dates in `localStorage` with manual JSON backup files.

## Option 3: Event-Sourced Habit Log

Record immutable habit events (created, paused, checked, unchecked) and replay them on every read.
