# Console design (Console theme)

## Summary

A theme for monitoring, data and developer tools: operations boards,
queues, pipelines, logs, fleet and sensor views, anything a specialist
watches as it changes. It should feel like a dark operations screen: high
contrast, every figure in monospace, colour spent only on state, and one
acid accent for the action and the live signal. This page is the theme's
foundations: read all of it before you draw, and follow it unless the task
says otherwise.

## Direction

- Idea: near-black surfaces in both light and dark mode, cool grey text,
  monospace for every figure and identifier, a condensed sans for labels,
  tiles with sparklines, and a live event stream beside the main table.
- Colour: acid lime `#c6f432` marks the primary action, the current rail
  item, the live dot and the main series in a chart. State colours are
  green `#3ddc84`, amber `#f5b83d` and red `#ff5f56`, used as text and
  thin bars on dark, never as large fills.
- Type: a coding mono (SF Mono, Cascadia Mono, Menlo, Consolas) for data;
  Avenir Next Condensed (DIN Alternate on Apple, Bahnschrift on Windows)
  for labels and names.
- Signature: a status strip across the top with a pulsing LIVE marker,
  sync age and a clock; KPI tiles with sparklines; a command bar with a
  prompt and ⌘K over the table.

## Palette and roles

The theme is dark in light mode too: `:root` and `.dark` carry the same
values and `color-scheme: dark`.

| Role             | Value                  | Use                                            |
| ---------------- | ---------------------- | ---------------------------------------------- |
| background       | `#090c10`              | the page and the status strip                  |
| card             | `#0f141a`              | panels: tiles, the table, the stream, forms    |
| popover          | `#151b23`              | menus, dialogs, the command palette            |
| foreground       | `#dbe3ec`              | figures, names, body text                      |
| muted-foreground | `#7c8ba1`              | labels, units, timestamps, secondary values    |
| border           | `#1f2833`              | panel edges and row rules                      |
| primary          | `#c6f432` on `#0b0f05` | primary button, current rail item, live signal |
| accent           | `#1a2410` on `#c6f432` | selected row, active filter tag                |
| success          | `#3ddc84` on `#0f2a1c` | healthy, ok, gains                             |
| warning          | `#f5b83d` on `#2e2208` | degraded, low, flagged                         |
| destructive      | `#ff5f56` on `#0f141a` | down, out, failed, losses                      |

Contrast pairs that must hold (WCAG AA or better): foreground on card
(14:1), muted-foreground on card (5.3:1), dark text on the lime primary
(15:1), lime on its accent tint (12.6:1), each state colour on its tint
or on card (6:1 or better). Never put muted text on a state tint, and
never set body text in lime.

## Type scale

- Families: `--font-sans: "Avenir Next Condensed", "DIN Alternate",
  Bahnschrift, "Arial Narrow", sans-serif-condensed, sans-serif` for labels
  and names; `--font-mono: ui-monospace, "SF Mono", "Cascadia Mono",
  Menlo, Consolas, monospace` for every figure, code, identifier,
  timestamp and input value. A mockup cannot load outside fonts, so these
  are faces that ship with the operating systems: Avenir Next Condensed
  and SF Mono on Apple devices, Bahnschrift and Cascadia Mono or Consolas
  on Windows. The app may later self-host JetBrains Mono or IBM Plex Mono
  and a condensed grotesk such as IBM Plex Sans Condensed.
- Scale (rem): 1.5 page title (mono, 600, the record's id or the view's
  name in lower case), 1.75 KPI figure (mono, 600), 0.875 names and body
  (sans 500), 0.78 table data (mono 400), 0.6875 labels and column heads
  (sans 600, uppercase, 0.08em tracking), 0.6875 state words (mono 700,
  uppercase).
- Figures: mono, tabular, right-aligned, with units in muted text after
  the number. Signed changes carry their sign (+60, -4).

## Spacing and density

- A 4px grid: 2, 4, 8, 12, 16, 24. Panels have 12px padding and sit 12px
  apart; the page has a 12px gutter. No large empty margins.
- High density: table rows 32 to 34px, so a desk shows 20 or more records
  with the stream beside them. On a phone touch targets stay 44px by
  giving rows more height, not larger type.

## Radii and elevation

- `--radius: 0.25rem`, `--radius-sm: 0.125rem`, `--radius-lg: 0.375rem`:
  nearly square. State markers are 6px squares.
- No shadows: panels are a card fill with a 1px border. Popovers and the
  command palette get a border and a dark shadow only to lift them off the
  table.

## Layout

- Wide screens (1024px and up): a 40px status strip across the top (the
  product as `name/area` in mono, a lime LIVE dot, "synced 3s ago" and the
  number of sources in muted text, a clock, the signed-in user). Under it,
  a 56px icon rail on the left with the main destinations as icons (with
  tooltips) and settings at its foot; content fills the rest edge to edge
  with no maximum width.
- Narrow screens (under 768px): the strip keeps the product, LIVE and the
  clock; the rail becomes a bottom bar of the same icons. Tiles go two to
  a row, the event stream moves behind a tab on the list screen, and the
  table drops secondary columns.
- Navigation lists only the main views (for example Parts, Inbound,
  Moves, Activity). A record, a form and sign-in are reached from where
  they belong: a row opens its record, the command bar's or the record's
  button opens its form, the user name opens the account and sign-out.
- List screens: a row of four KPI tiles (label, big mono figure, a muted
  line of context, a sparkline in the state or muted colour; the tile
  that needs attention has an amber edge), then a command bar (a prompt
  word, the filter input with a hint such as "filter by sku, name or
  state:low", a ⌘K key cap, the active filters as tags, and the primary
  button at the end), then the main table panel and, on a desk, a 360px
  event stream panel to its right that tails the latest changes with time,
  id, signed amount and a muted description.
- Lists of records: a dense table: id in mono, name in the sans, one
  column per location as an inline meter (the number then a thin bar in
  the state colour), the total, a target and a fill percentage, and a
  State column (a square marker and an uppercase word). Flagged rows carry
  a 2px state-coloured bar at their left edge. A footer line under the
  table counts rows, flagged rows and the update time. On a phone the
  table keeps id, name with a muted second line of compact values ("N 14 ·
  D 3 · R 40"), total and state.
- A record's page: a muted crumb ("parts /"), the id as the title with
  the name and facts in a muted line, the state marker, and Move and the
  primary button on the right; then a row of five tiles; then a 30-day
  chart panel (the series in lime over a faint fill, the threshold as a
  dashed amber line, a grid of faint rules) beside a facts panel; then the
  event log as a table (time, event, signed quantity, site, actor,
  reason).
- Forms: a panel with fields in two columns on a desk, labels in small
  uppercase sans above 32px inputs whose values are mono; choices between
  two or three options are a segmented toggle; a footer bar shows the
  keyboard hints (⏎ record, esc cancel) on the left and Cancel and the
  primary button on the right. A side panel previews what will change as
  before and after figures. On a phone the fields stack, the hints hide
  and the footer buttons go full width.
- Empty, loading and error: empty keeps the table header and says in mono
  what matched ("0 rows match "gate valve" in 12 parts across 2 sites"),
  then a line of suggested filters as key-styled chips and Clear filter
  with New part; loading is the table header with shimmering rows and the
  LIVE marker grey; an error is a red-bordered line at the top of the
  panel with the failing source, the time and a retry, and field errors in
  red mono under their field.

## Components

- Buttons: 32px on a desk (44 on a phone), nearly square. Primary is lime
  with near-black text; ghost is transparent with a border; the icon leads
  the short label (Plus, Delivery).
- Inputs: 32px, card fill, `--input` border, mono values, a lime focus
  ring; the command input carries a prompt word and a ⌘K key cap.
- Tables: column heads in small uppercase muted sans on the card, no fill;
  1px rules; the hovered row lifted to `--secondary`; numbers right; ids
  in a lighter blue-grey mono.
- State: a 6px square marker in the state colour and the word in
  uppercase mono ("OK", "LOW", "OUT"); never colour alone.
- Tiles and charts: sparklines are a 1.5px line with no axes; a chart has
  faint grid rules, a lime series and dashed thresholds in the state
  colour.
- Icons: lucide at 14px in controls and 18px in the rail, 1.75px stroke.

## Wording

Terse and exact, in lower case for system words: "synced 3s ago", "filter
by sku", "12 rows · 4 flagged · updated 09:14:19". Names and labels stay in
plain words a person understands. Times in 24-hour form with seconds where
it matters; amounts always with a sign when they change something.

## Do and do not

- Do set every figure, id and time in mono, right-aligned. Do not set
  numbers in the sans.
- Do spend colour only on state and the one lime action. Do not tint
  whole cards or rows; use a thin edge bar or a marker.
- Do keep the stream beside the table on a desk. Do not push live changes
  into a separate screen when there is room.
- Do keep the theme dark in light mode too. Do not invert it to a white
  page.
- Do fill the width with panels on a 12px gutter. Do not centre a narrow
  column with wide empty margins.

## Tokens

The exact values are in `designs/styles.css` (`:root` and `.dark`), with the
names the kit uses.
