# Workbench design (Workbench theme)

## Summary

A theme for internal business tools that people keep open all day: stock and
inventory, orders, dispatch, bookings, records. It should feel dependable,
dense and calm, like a well-made ledger: the figures are the interface, and
everything else stays out of their way. This page is the theme's foundations:
read all of it before you draw, and follow it unless the task says otherwise.

## Direction

- Idea: a warm paper-white working surface, ink-dark text, one deep teal
  accent and a strict status palette. Information-dense, tabular, quiet.
- Colour: teal `#0f6b5c` marks the primary action, the current place in the
  navigation and links. Status has its own colours and never borrows the
  accent.
- Type: Avenir Next (Segoe UI Variable on Windows, Helvetica Neue elsewhere)
  for text; a monospaced face with tabular figures for codes, part numbers and
  quantities. Three clear levels: page title, section heading, body.
- Signature: every list of records is a real table with a column per
  measure and right-aligned tabular numbers; status is always a small tinted
  badge with a word.

## Palette and roles

| Role             | Light                  | Dark                   | Use                                     |
| ---------------- | ---------------------- | ---------------------- | --------------------------------------- |
| background       | `#f6f5f2`              | `#121413`              | the page behind cards and tables        |
| card             | `#ffffff`              | `#1a1d1c`              | tables, forms, detail panels            |
| foreground       | `#1c1b19`              | `#ecebe7`              | body text, figures                      |
| muted-foreground | `#5c5a55`              | `#a3a19b`              | labels, column headers, secondary text  |
| border           | `#dedbd3`              | `#2c302e`              | table rules, card edges, dividers       |
| primary          | `#0f6b5c`              | `#4fbfa8`              | primary button, current nav item, links |
| success          | `#e2f1e8` on `#1f6b3f` | `#13301f` on `#8fd6ab` | in stock, done                          |
| warning          | `#fbefd5` on `#8a5200` | `#36280c` on `#f0c36a` | low, needs attention                    |
| destructive      | `#fbe4e1` on `#a62a1f` | `#3a1612` on `#f2958a` | out, refused, failed                    |

Contrast pairs that must hold (WCAG AA or better): foreground on background
and card (15:1), muted-foreground on card (6.6:1), primary-foreground white on
primary (6.1:1), each status foreground on its tint (5:1 or better). Never put
muted text on a tint.

## Type scale

- Families: `--font-sans: "Avenir Next", "Segoe UI Variable Text", "Segoe UI",
  "Helvetica Neue", Arial, sans-serif`; `--font-mono: "SF Mono", "Cascadia
  Mono", "JetBrains Mono", Menlo, Consolas, monospace`. A mockup cannot load
  outside fonts, so the theme names faces that ship with the operating
  systems the tool runs on, in order of preference; the app may self-host a
  web font with the same character later.
- Scale (rem): 1.75 page title (600, -0.01em), 1.125 section heading (600),
  0.9375 body (400), 0.8125 label and column header (500, uppercase only for
  column headers, 0.04em tracking), 0.75 badge (600).
- Figures: `font-variant-numeric: tabular-nums` on every quantity, money and
  date column; part numbers and codes in the mono face at body size.
- Line height 1.45 for text, 1.25 for table rows and headings.

## Spacing and density

- A 4px grid: 4, 8, 12, 16, 24, 32, 48. Card padding 16 on a phone, 24 on a
  desk. Section gap 24. Table cell padding 8 vertical, 12 horizontal.
- Comfortable density for a desk tool: a table row is about 40px high, so a
  screen shows 15 to 20 records. Touch targets on a phone are at least 44px
  high, achieved with row height and padding, not by enlarging the type.

## Radii and elevation

- `--radius: 0.375rem`; badges fully rounded; inputs and buttons use the
  radius; cards use radius-lg. No pill buttons.
- Elevation is a hairline border plus the faintest shadow on cards; popovers
  and dialogs carry the only real shadow. No gradients, no glass.

## Layout

- Desk first, then fold. At 1024px and up: a left sidebar 232px wide with the
  product name, the main destinations and the signed-in person at its foot;
  content to its right, at most 1200px wide for tables and 640px for forms.
- At phone width: a top bar with the product name, the screen title and a
  Menu button that opens the same destinations as a sheet. No bottom tab bar.
- Navigation lists only top-level destinations (for example Orders, Customers,
  Reports). A record's page, a form and sign-in are reached from where they
  belong: a row opens its record; an action on the record opens its form.
- Page header: title, one line of context (counts, last updated), the primary
  action on the right sized to its label. Secondary actions are quiet
  buttons beside it or in a menu.
- Lists of records: a table with a sticky header row, the identifying column
  first (code and name), one column per measure (one per location when there
  are locations, then a total), a status column, and the row opening the
  record. Filters and search sit in one bar above the table. On a phone each
  row becomes a two-line list item: name and code on the first line, the two
  most important measures as labelled values and the status badge on the
  second.
- A record's page: a header with name, code and status; a summary band of the
  key figures (one per location and the total) in large tabular numbers; the
  actions as a row of buttons; then the history as a table, newest first.
  On a desk, summary and actions sit in a column beside the history.
- Forms: one column, labels above fields, related fields grouped under a
  small heading, the current value shown beside what the form changes, the
  primary button at the end aligned left with Cancel beside it. Full-width
  buttons only on a phone.
- Empty, loading and error: empty is a short sentence saying what will appear
  and the action that adds the first item; loading is skeleton rows in the
  table's shape; an error is a tinted destructive banner at the top of the
  card with what happened and what to do, and field errors under their field.

## Components

- Buttons: primary filled teal with white text; secondary white with a border;
  quiet text buttons for tertiary actions; destructive outline in red. Height
  36px on a desk, 44px on a phone.
- Inputs: 36px high (44 on a phone), border `--input`, focus ring teal 2px;
  a search field carries its icon inside on the left.
- Tables: header row on `--muted` with muted uppercase labels; rows divided by
  hairlines; the hovered row tinted `--accent`; numbers right-aligned; the
  low or out cell tinted with its status colour as well as the row's badge.
- Badges: small, rounded, tinted background with the status word in the
  status foreground ("Low", "Out", "In stock", "Flagged"). Always text, never
  colour alone.
- Figures: a stat is a label above a large tabular number, with the unit
  small beside it.
- Icons: lucide at 16px, 1.75px stroke, only where they speed recognition.

## Wording

Short, plain and specific to the business: "Record delivery", not "Submit";
"3 items are low at the east site", not "Attention needed". Name things the way the
people who use the tool do. Times as "Today 09:42". Quantities with units
when they have them.

## Do and do not

- Do show a list of 40 records as a table with a column per measure (for
  example Code, Name, Site A, Site B, Total, Status). Do not stack cards with
  "Site A 5 · Site B 14" run together in a sentence.
- Do size the primary button to its label in the page header. Do not stretch
  a button across a 1,100px desktop content area.
- Do mark a low count with a warning badge and a tinted cell. Do not write
  "low" in plain grey text.
- Do give the desk a sidebar and multi-column record page. Do not ship the
  phone layout stretched to desktop width.

## Tokens

The exact values are in `designs/styles.css` (`:root` and `.dark`), with the
names the kit uses.
