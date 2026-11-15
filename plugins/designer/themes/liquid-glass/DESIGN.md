# Northline wholesale design (Liquid glass theme)

## Summary

A sample app in the Liquid glass look: a small coffee roaster's wholesale
desk, where the owner sees what needs attention today and works through
café orders. It should feel light, fluid and native to an iPhone or a Mac,
with depth coming from layers of frosted glass rather than lines.

Mockup: `.builder/designs/index.html`. Open it from disk.

## Direction

- The person's words for the look and feel: "liquid glass, like iOS".
- Idea: iOS-like translucent layers, background blur, vivid colour behind
  frosted surfaces and fluid curves. The content floats; the colour field
  behind it gives each screen its mood.
- Colour: system blue `#0a72f0` as the primary on a pale blue-grey page.
  Three solid colour fields (blue, pink, mint) blurred into soft light sit
  behind the glass; they are decoration only and never carry meaning.
- Type: the Apple system stack (`-apple-system`, SF Pro), bold tight
  headings (-0.025em), tabular figures.
- Signature: the floating frosted top bar, inset from the edges and sticky,
  over the moving colour field; every card is the same glass with a bright
  1px top edge.
- Icons: lucide, 16px, 2px stroke.

## App shell

- Navigation: a floating `TopBar` with pill-shaped destinations, the way
  iOS tab and tool bars float over content.
- Destinations, in order: Overview (house), Orders (package).
- Shell parts: round blue mark and name, the destinations, `ThemeToggle` at
  the right.
- At 1280px: one floating bar, content at most 1200px wide. At 768px: the
  same bar. At 360px: the destinations wrap to a second row inside the bar.

## Tokens

Paste these blocks into the client's global CSS after the
`@corbits/react-ui` theme import. Names match the kit; `--glass-blur`,
`--glass-edge`, `--scene-1` to `--scene-3` and the warning pair are this
theme's additions. Surfaces are translucent, so every glass surface also
sets `backdrop-filter: var(--glass-blur)`.

```css
:root {
  --background: #eef1f8;
  --foreground: #0f1222;
  --card: rgb(255 255 255 / 0.58);
  --card-foreground: #0f1222;
  --popover: rgb(255 255 255 / 0.78);
  --popover-foreground: #0f1222;
  --primary: #0a72f0;
  --primary-foreground: #ffffff;
  --primary-active: #075ec7;
  --secondary: rgb(255 255 255 / 0.5);
  --secondary-foreground: #0f1222;
  --muted: rgb(15 18 34 / 0.06);
  --muted-foreground: #4a5068;
  --accent: rgb(10 114 240 / 0.12);
  --accent-foreground: #0657bb;
  --destructive: #e5352b;
  --destructive-foreground: #ffffff;
  --success: rgb(40 180 99 / 0.18);
  --success-foreground: #11683a;
  --warning: rgb(255 159 10 / 0.2);
  --warning-foreground: #8a4b00;
  --border: rgb(255 255 255 / 0.7);
  --input: rgb(15 18 34 / 0.16);
  --ring: #0a72f0;
  --glass-blur: blur(24px) saturate(180%);
  --glass-edge:
    inset 0 1px 0 rgb(255 255 255 / 0.85), 0 0 0 1px rgb(255 255 255 / 0.45);
  --scene-1: #5b8cff;
  --scene-2: #ff7ac6;
  --scene-3: #3fe0c5;
  --radius: 1.125rem;
  --font-sans:
    -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, "Segoe UI",
    Roboto, sans-serif;
}
.dark {
  --background: #070a16;
  --foreground: #f1f3fb;
  --card: rgb(28 32 52 / 0.52);
  --card-foreground: #f1f3fb;
  --popover: rgb(28 32 52 / 0.82);
  --popover-foreground: #f1f3fb;
  --primary: #3d95ff;
  --primary-foreground: #ffffff;
  --primary-active: #62a9ff;
  --secondary: rgb(255 255 255 / 0.08);
  --secondary-foreground: #f1f3fb;
  --muted: rgb(255 255 255 / 0.07);
  --muted-foreground: #a7adc6;
  --accent: rgb(61 149 255 / 0.2);
  --accent-foreground: #a9cfff;
  --destructive: #ff6a5f;
  --destructive-foreground: #070a16;
  --success: rgb(48 209 88 / 0.2);
  --success-foreground: #8ff0ae;
  --warning: rgb(255 159 10 / 0.22);
  --warning-foreground: #ffc76b;
  --border: rgb(255 255 255 / 0.12);
  --input: rgb(255 255 255 / 0.18);
  --ring: #3d95ff;
  --glass-edge:
    inset 0 1px 0 rgb(255 255 255 / 0.14), 0 0 0 1px rgb(255 255 255 / 0.08);
  --scene-1: #2a4fd6;
  --scene-2: #a2257a;
  --scene-3: #0c8a7a;
}
@media (prefers-color-scheme: dark) {
  :root:not(.dark):not(.light) {
    /* same as .dark */
  }
}
```

Changed from kit defaults: every colour (translucent surfaces and a system
blue primary), `--radius` to 1.125rem, `--font-sans` to the Apple system
stack, and shadows that pair a bright glass edge with a soft drop.

| Role           | Token                | Tailwind class                                     |
| -------------- | -------------------- | -------------------------------------------------- |
| Page           | `--background`       | `bg-background`                                    |
| Text           | `--foreground`       | `text-foreground`                                  |
| Secondary text | `--muted-foreground` | `text-muted-foreground`                            |
| Glass surface  | `--card`             | `bg-card backdrop-blur-xl backdrop-saturate-[1.8]` |
| Main action    | `--primary`          | `bg-primary text-primary-foreground rounded-full`  |
| Selected row   | `--accent`           | `bg-accent text-accent-foreground`                 |

Type scale: 12/16, 13/18, 14/20, 16/24, 32/38, 32/40.
Weights: 400, 500, 600, 700.
Spacing: 4, 8, 12, 16, 20, 24, 40, 64px.
Radii: `--radius-sm` 12px, `--radius` 18px, `--radius-lg` 24px; buttons,
inputs and destinations are pills.
Shadows: `--shadow-card` on every glass surface, `--shadow-popover` on
dialogs and toasts.
Motion: `--duration-micro` 150ms, `--duration-standard` 240ms, `--ease-out`.

## Components

| Mockup class      | Kit component              | Used for                 |
| ----------------- | -------------------------- | ------------------------ |
| `.button`         | `Button`                   | primary actions, pill    |
| `.button-outline` | `Button variant="outline"` | secondary actions, glass |
| `.input`          | `Input`                    | search and form text     |
| `.card`           | `Card`                     | glass stats and panels   |
| `.table`          | `Table`                    | the orders list          |
| `.badge`          | `Badge`                    | tinted order state       |
| `.dialog`         | `Dialog`                   | new order, frosted       |
| `.toast`          | `toast` from sonner        | confirmations            |

## Screens

### Overview

- Route: `/` (mockup `#/overview`)
- Purpose: see what needs attention today.
- Layout, top to bottom: date and greeting with Review orders, three glass
  stat cards with the lead figure on solid blue, the Needs attention list.
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
- Layout, top to bottom: title and New order, then the list with a pill
  search beside the selected order's detail.
- Shows: order number, café, total and status; the detail adds dates,
  address, line items and actions.
- 1280px: list and a 360px detail side by side. 768px: detail under the
  list. 360px: the table scrolls sideways inside its card.
- States:
  - populated: five orders, the first selected with a blue tint.
  - empty: "No orders yet" with Add an order by hand.
  - loading and error: three skeleton rows; a card that says the
    connection dropped, with Try again.
- Test ids: `orders-title`, `orders-new-button`, `orders-search-input`,
  `orders-list`, `orders-detail`, `orders-ship-button`.

## Flows

### F1 Ship an order

1. On `/orders`, pick the order in the list.
2. Read its lines in the detail and press Mark as shipped.
3. Result: a frosted toast confirms the café gets the tracking link.

### F2 Add an order by hand

1. On `/orders`, press New order.
2. Fill in the café and the coffee, then Save order.
3. Result: the order heads the list.

## Interaction notes

- Search filters the list as the person types; no match shows a sentence.
- Selecting a row moves the blue tint and fills the detail.
- The top bar stays floating as the page scrolls under it.
- Where the browser has no backdrop blur, glass falls back to solid near-white
  (light) or deep navy (dark) surfaces.
- Marking an order shipped shows a toast for 4000ms.
