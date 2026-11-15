# Northline wholesale design (Modern and sleek theme)

## Summary

A sample app in the Modern and sleek look: a small coffee roaster's
wholesale desk, where the owner sees what needs attention today and works
through café orders. It should feel quiet, fast and exact, like a tool a
careful person keeps open all day.

Mockup: `.builder/designs/index.html`. Open it from disk.

## Direction

- The person's words for the look and feel: "modern and sleek".
- Idea: crisp neutrals, one confident accent, generous whitespace, tight
  sans-serif type and subtle depth. Nothing competes with the figures.
- Colour: cobalt `#2747d6` as the one accent, on cool zinc neutrals. The
  accent marks the primary action, the selected row and links in progress;
  everything else is grey.
- Type: the system sans stack (`system-ui`, San Francisco, Segoe UI,
  Roboto). Headings are tracked tight (-0.02em), figures are tabular.
- Signature: the lead figure on the overview sits on a solid ink card while
  the others stay white, so the one number that matters this week reads
  first.
- Icons: lucide, 16px, 2px stroke.

## App shell

- Navigation: `TopBar`, since the app has two destinations and wide tables
  need the full width.
- Destinations, in order: Overview (house), Orders (package).
- Shell parts: product mark and name, the destinations, `ThemeToggle` at the
  right.
- At 1280px: one bar, content at most 1200px wide. At 768px: the same bar.
  At 360px: the destinations wrap to a second row under the name.

## Tokens

Paste these blocks into the client's global CSS after the
`@corbits/react-ui` theme import. Names match the kit.

```css
:root {
  --background: #fafafa;
  --foreground: #18181b;
  --card: #ffffff;
  --card-foreground: #18181b;
  --popover: #ffffff;
  --popover-foreground: #18181b;
  --primary: #2747d6;
  --primary-foreground: #ffffff;
  --primary-active: #1d37b0;
  --secondary: #f1f1f3;
  --secondary-foreground: #18181b;
  --muted: #f1f1f3;
  --muted-foreground: #5f5f68;
  --accent: #eef1fd;
  --accent-foreground: #1d37b0;
  --destructive: #c42b2b;
  --destructive-foreground: #ffffff;
  --success: #e3f4ea;
  --success-foreground: #17603a;
  --warning: #fdf1dc;
  --warning-foreground: #8a5300;
  --border: #e4e4e7;
  --input: #c9c9cf;
  --ring: #2747d6;
  --radius: 0.625rem;
  --font-sans:
    system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial,
    sans-serif;
}
.dark {
  --background: #0b0b0d;
  --foreground: #f4f4f5;
  --card: #151518;
  --card-foreground: #f4f4f5;
  --popover: #1c1c20;
  --popover-foreground: #f4f4f5;
  --primary: #7089ff;
  --primary-foreground: #0b0b0d;
  --primary-active: #8ea1ff;
  --secondary: #222227;
  --secondary-foreground: #f4f4f5;
  --muted: #1c1c20;
  --muted-foreground: #a1a1aa;
  --accent: #1d2240;
  --accent-foreground: #b9c5ff;
  --destructive: #f07272;
  --destructive-foreground: #0b0b0d;
  --success: #12301f;
  --success-foreground: #8fdcae;
  --warning: #36270c;
  --warning-foreground: #f2c46d;
  --border: #27272c;
  --input: #3f3f46;
  --ring: #7089ff;
}
@media (prefers-color-scheme: dark) {
  :root:not(.dark):not(.light) {
    /* same as .dark */
  }
}
```

Changed from kit defaults: every colour (cool zinc neutrals and a cobalt
accent instead of the kit's orange), `--radius` to 0.625rem and
`--font-sans` to the system stack.

| Role           | Token                | Tailwind class                       |
| -------------- | -------------------- | ------------------------------------ |
| Page           | `--background`       | `bg-background`                      |
| Text           | `--foreground`       | `text-foreground`                    |
| Secondary text | `--muted-foreground` | `text-muted-foreground`              |
| Divider        | `--border`           | `border-border`                      |
| Main action    | `--primary`          | `bg-primary text-primary-foreground` |
| Selected row   | `--accent`           | `bg-accent text-accent-foreground`   |

Type scale: 12/16, 13/18, 14/20, 16/24, 28/36, 32/40.
Weights: 400, 500, 600.
Spacing: 4, 8, 12, 16, 20, 24, 40, 64px.
Radii: `--radius-sm` 8px, `--radius` 10px, `--radius-lg` 14px, pills 9999px.
Shadows: a hairline ring on cards; `--shadow-popover` on dialogs and toasts.
Motion: `--duration-micro` 150ms, `--duration-standard` 200ms, `--ease-out`.

## Components

| Mockup class      | Kit component              | Used for              |
| ----------------- | -------------------------- | --------------------- |
| `.button`         | `Button`                   | primary actions       |
| `.button-outline` | `Button variant="outline"` | secondary actions     |
| `.input`          | `Input`                    | search and form text  |
| `.card`           | `Card`                     | stats and panels      |
| `.table`          | `Table`                    | the orders list       |
| `.badge`          | `Badge`                    | order and alert state |
| `.dialog`         | `Dialog`                   | new order             |
| `.toast`          | `toast` from sonner        | confirmations         |

## Screens

### Overview

- Route: `/` (mockup `#/overview`)
- Purpose: see what needs attention today.
- Layout, top to bottom: date and greeting with Review orders, three stat
  cards with the lead figure on ink, the Needs attention list.
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
- Shows: order number, café, total and status; the detail adds dates,
  address, line items and actions.
- 1280px: list and a 360px detail side by side. 768px: detail under the
  list. 360px: the table scrolls sideways inside its card.
- States:
  - populated: five orders, the first selected.
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
- Selecting a row moves the accent highlight and fills the detail.
- Marking an order shipped shows a toast for 4000ms.
