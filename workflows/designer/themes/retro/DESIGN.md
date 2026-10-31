# Northline wholesale design (Retro theme)

## Summary

A sample app in the Retro look: a small coffee roaster's wholesale desk,
where the owner sees what needs attention today and works through café
orders. It should feel warm, tactile and a little playful, like a well-worn
order book from a 70s corner shop, while staying quick to use.

Mockup: `.builder/designs/index.html`. Open it from disk.

## Direction

- The person's words for the look and feel: "retro".
- Idea: a nostalgic palette, chunky outlines, 70s-style display type and
  tactile, toy-like controls. Every surface is printed paper with an ink
  edge; every button is a key that presses into the page.
- Colour: tomato `#d2482a` as the primary on cream paper `#f5ead6` with
  brown ink `#2b1d14`. Mustard fills the top bar and warning badges; teal is
  the focus ring and the success tone.
- Type: a soft display serif for headings and figures (Cooper Black, falling
  back to Rockwell, Bookman and Georgia), Avenir Next for body text, Courier
  for order numbers.
- Signature: 2px ink outlines with hard 4px offset shadows. Buttons sit on a
  3px shadow and drop into it when pressed.
- Icons: lucide, 16px, 2px stroke.

## App shell

- Navigation: `TopBar` on a mustard band, since two destinations fit and the
  band carries the period colour.
- Destinations, in order: Overview (house), Orders (package).
- Shell parts: round tomato mark and name, the destinations, `ThemeToggle`
  at the right.
- At 1280px: one bar, content at most 1200px wide. At 768px: the same bar.
  At 360px: the destinations wrap to a second row under the name.

## Tokens

Paste these blocks into the client's global CSS after the
`@corbits/react-ui` theme import. Names match the kit; `--outline`,
`--shadow-card`, `--font-display` and the warning pair are this theme's
additions.

```css
:root {
  --background: #f5ead6;
  --foreground: #2b1d14;
  --card: #fff8ec;
  --card-foreground: #2b1d14;
  --popover: #fff8ec;
  --popover-foreground: #2b1d14;
  --primary: #d2482a;
  --primary-foreground: #fff8ec;
  --primary-active: #b53a1f;
  --secondary: #e8b23a;
  --secondary-foreground: #2b1d14;
  --muted: #ecdcc0;
  --muted-foreground: #6b4f3a;
  --accent: #f3d7a0;
  --accent-foreground: #2b1d14;
  --destructive: #a32c1c;
  --destructive-foreground: #fff8ec;
  --success: #9cc9b8;
  --success-foreground: #12352c;
  --warning: #e8b23a;
  --warning-foreground: #2b1d14;
  --border: #2b1d14;
  --input: #2b1d14;
  --ring: #2a7d78;
  --radius: 0.75rem;
  --outline: 2px solid var(--border);
  --shadow-card: 4px 4px 0 var(--border);
  --shadow-popover: 6px 6px 0 var(--border);
  --font-sans:
    "Avenir Next", Avenir, "Trebuchet MS", "Segoe UI", system-ui, sans-serif;
  --font-display:
    "Cooper Black", "Cooper Std", Rockwell, "Bookman Old Style", Georgia, serif;
  --font-mono: "Courier New", Courier, ui-monospace, monospace;
}
.dark {
  --background: #1f1712;
  --foreground: #f5e6cc;
  --card: #2c2119;
  --card-foreground: #f5e6cc;
  --popover: #2c2119;
  --popover-foreground: #f5e6cc;
  --primary: #f0663f;
  --primary-foreground: #1f1712;
  --primary-active: #ff7d57;
  --secondary: #e8b23a;
  --secondary-foreground: #1f1712;
  --muted: #3a2c21;
  --muted-foreground: #c9ad8c;
  --accent: #4a3923;
  --accent-foreground: #f5e6cc;
  --destructive: #ff8a70;
  --destructive-foreground: #1f1712;
  --success: #2f5e52;
  --success-foreground: #d7f0e6;
  --warning: #e8b23a;
  --warning-foreground: #1f1712;
  --border: #0d0907;
  --input: #f5e6cc;
  --ring: #5cc1b9;
  --shadow-card: 4px 4px 0 #0d0907;
  --shadow-popover: 6px 6px 0 #0d0907;
}
@media (prefers-color-scheme: dark) {
  :root:not(.dark):not(.light) {
    /* same as .dark */
  }
}
```

Changed from kit defaults: every colour (a 70s cream, brown, tomato, mustard
and teal palette), `--radius` to 0.75rem, the fonts, and solid offset
shadows in place of soft ones.

| Role           | Token                | Tailwind class                           |
| -------------- | -------------------- | ---------------------------------------- |
| Page           | `--background`       | `bg-background`                          |
| Text           | `--foreground`       | `text-foreground`                        |
| Secondary text | `--muted-foreground` | `text-muted-foreground`                  |
| Ink outline    | `--border`           | `border-2 border-border`                 |
| Main action    | `--primary`          | `bg-primary text-primary-foreground`     |
| Top bar        | `--secondary`        | `bg-secondary text-secondary-foreground` |

Type scale: 11/16 (badges, uppercase), 13/18, 14/20, 20/28, 32/40, 34/40.
Weights: 400 display, 400, 600 and 700 body.
Spacing: 4, 8, 12, 16, 20, 24, 40, 64px.
Radii: `--radius-sm` 8px, `--radius` 12px, `--radius-lg` 16px, pills 9999px.
Shadows: `--shadow-card` on cards, 3px on buttons, `--shadow-popover` on
dialogs and toasts; all solid ink, never blurred.
Motion: buttons translate 3px into their shadow over 120ms on press.

## Components

| Mockup class      | Kit component              | Used for                     |
| ----------------- | -------------------------- | ---------------------------- |
| `.button`         | `Button`                   | primary actions, ink-edged   |
| `.button-outline` | `Button variant="outline"` | secondary actions            |
| `.input`          | `Input`                    | search and form text, 2px    |
| `.card`           | `Card`                     | stats and panels, ink shadow |
| `.table`          | `Table`                    | the orders list              |
| `.badge`          | `Badge`                    | uppercase order state        |
| `.dialog`         | `Dialog`                   | new order                    |
| `.toast`          | `toast` from sonner        | confirmations                |

## Screens

### Overview

- Route: `/` (mockup `#/overview`)
- Purpose: see what needs attention today.
- Layout, top to bottom: date and greeting with Review orders, three stat
  cards with the lead figure on tomato, the Needs attention list.
- Shows: open orders, shipments today, revenue this week in dollars, and
  alerts with a badge, a sentence and a relative time.
- 1280px: three stats in a row. 768px: the same. 360px: stats stack.
- States:
  - populated: as described.
- Test ids: `overview-title`, `overview-orders-button`,
  `overview-open-total`, `overview-shipping-total`,
  `overview-revenue-total`, `overview-attention-list`.

### Orders

- Route: `/orders` (mockup `#/orders`)
- Purpose: find an order and move it along.
- Layout, top to bottom: title and New order, then the list with search
  beside the selected order's detail.
- Shows: order number in Courier, café, total and status; the detail adds
  dates, address, line items and actions.
- 1280px: list and a 360px detail side by side. 768px: detail under the
  list. 360px: the table scrolls sideways inside its card.
- States:
  - populated: five orders, the first selected with a tomato edge.
  - empty: "No orders yet" with Add an order by hand.
  - loading and error: three skeleton rows; a card that says the
    connection dropped, with Try again.
- Test ids: `orders-title`, `orders-new-button`, `orders-search-input`,
  `orders-list`, `orders-detail`, `orders-ship-button`.

## Flows

### F1 Ship an order

1. On `/orders`, pick the order in the list.
2. Read its lines in the detail and press Mark as shipped.
3. Result: a toast confirms the café gets the tracking link.

### F2 Add an order by hand

1. On `/orders`, press New order.
2. Fill in the café and the coffee, then Save order.
3. Result: the order heads the list.

## Interaction notes

- Search filters the list as the person types; no match shows a sentence.
- Selecting a row moves the tomato edge and fills the detail.
- Buttons press 3px into their ink shadow; with reduced motion they do not
  move.
- Marking an order shipped shows a toast for 4000ms.
