# Sleek modern design (Sleek modern theme)

## Summary

A theme for customer-facing web apps and dashboards: portals, account
areas, booking and ordering sites, analytics a customer opens once a day.
It should feel polished, light and confident, like a well-funded product:
plenty of air, a few large figures that answer the first question, and
nothing that looks like an admin screen. This page is the theme's
foundations: read all of it before you draw, and follow it unless the task
says otherwise.

## Direction

- Idea: restrained cool neutrals, near-black ink for the main action, one
  violet accent for focus, selection and the lead figure, and soft layered
  shadows instead of borders. Roomy, centred, calm.
- Colour: ink `#16161b` fills the primary button; violet `#4b3df2` on its
  pale tint `#efedff` marks the current selection, the lead stat and links
  in text; the focus ring is violet `#6b5cff`. Status has its own colours
  and never borrows the violet.
- Type: Avenir Next (Segoe UI Variable Display on Windows, Roboto on
  Android) for everything, tabular figures throughout. Large tight
  headings, quiet small labels.
- Signature: a row of stat cards above every list, the first one tinted
  violet with the number that matters most; content held to a 1200px
  column in the middle of the page.

## Palette and roles

| Role             | Light                  | Dark                   | Use                                         |
| ---------------- | ---------------------- | ---------------------- | ------------------------------------------- |
| background       | `#f6f6f7`              | `#0c0c0f`              | the page behind cards                       |
| card             | `#ffffff`              | `#16161b`              | cards, the top bar, tables, dialogs         |
| foreground       | `#121216`              | `#f2f2f5`              | headings, body text, figures                |
| muted-foreground | `#6a6a75`              | `#a3a3ae`              | labels, column headers, secondary lines     |
| border           | `#e6e6ea`              | `#2a2a31`              | row dividers and the bar's bottom line only |
| primary          | `#16161b` on white     | `#f2f2f5` on `#121216` | the one primary button per screen           |
| accent           | `#efedff` on `#4b3df2` | `#24203f` on `#b8b0ff` | current nav item, lead stat, selection      |
| success          | `#e5f5ec` on `#187043` | `#10301f` on `#8fdcae` | in stock, paid, done                        |
| warning          | `#fff2d9` on `#8f5200` | `#36270c` on `#f2c46d` | low, due soon, needs attention              |
| destructive      | `#cc2f2f` with white   | `#f07878` on `#0c0c0f` | out, failed, delete                         |

Contrast pairs that must hold (WCAG AA or better): foreground on
background (17:1), muted-foreground on card (5.3:1) and on background
(4.9:1), white on primary (18:1), accent foreground on its tint (5.6:1),
each status foreground on its tint (5.4:1 or better), white on destructive
(5.2:1). Never put muted text on a tint.

## Type scale

- Families: `--font-sans: "Avenir Next", "Segoe UI Variable Display",
  "Segoe UI", Roboto, "Helvetica Neue", system-ui, sans-serif`;
  `--font-mono: ui-monospace, "SF Mono", "Cascadia Mono", Menlo, Consolas,
  monospace`. A mockup cannot load outside fonts, so the theme names faces
  that ship with each operating system: Avenir Next on Apple devices,
  Segoe UI on Windows, Roboto on Android. The app may later self-host a
  neutral geometric grotesk with tabular figures, such as Inter.
- Scale (rem): 2 page title (600, -0.02em, line 2.5), 2.5 stat figure (600,
  -0.02em), 1.25 empty-state heading (600), 1 card heading (600), 0.875
  body (400, line 1.25rem), 0.8125 label and secondary line (500), 0.75
  column header and badge (500).
- Figures: `font-variant-numeric: tabular-nums` on the whole page. Codes
  and references stay in the sans at 0.8125rem in muted foreground; the
  mono face is only for something a person copies, such as an API key.
- Column headers are sentence case, never uppercase.

## Spacing and density

- A 4px grid: 4, 8, 12, 16, 20, 24, 32, 40, 64. The page has 40px above the
  title and 24px between sections; card padding 24 on a desk, 16 on a
  phone.
- Relaxed density: a table row is about 56px with a two-line cell (name
  over code), so a screen shows 10 to 12 records. That is right for a
  customer who scans a few things, not for someone working through
  hundreds.

## Radii and elevation

- `--radius: 0.75rem`, `--radius-sm: 0.5rem` for buttons and inputs,
  `--radius-lg: 1rem` for cards. Badges and nav pills fully rounded.
- Elevation is the signature: cards carry a layered soft shadow (a 1px
  hairline of shadow, a 2px lift and a long faint blur) and no border.
  Dialogs and menus carry a deeper shadow. No gradients except the fade
  behind the phone's docked action.

## Layout

- Wide screens (1024px and up): a 64px white top bar across the page with
  the product mark and name, the main destinations as rounded pills in the
  middle-left, and on the right any scope picker (such as which site or
  account) and the person's avatar. No sidebar. Content sits in a centred
  column at most 1200px wide; forms in a 680px card.
- Narrow screens (under 768px): the bar is 56px with the mark, a Menu
  button that opens the destinations as a sheet, and the avatar. The page
  has 16px side margins. The screen's primary action docks at the bottom,
  full width and 48px high, over a fade of the background; the header's
  action buttons are hidden.
- Navigation lists only top-level destinations (for example Overview,
  Orders, Customers, Settings). A record, a form, sign-in and the account
  page are reached from where they belong: a row opens its record, an
  action opens its form, the avatar opens account and sign-out.
- Page header: the title, one line of context in muted text (a count, a
  period), and on the right one outline button and the primary button.
- Stats: under the header, a row of three stat cards (label, large figure,
  one muted line of context). The first is the lead stat on the violet
  tint. On a phone the lead spans the row and the other two sit side by
  side without their context line.
- Lists of records: a toolbar (a 40px search field and a segmented filter
  with counts such as All 12, Low 3, Out 1) above one card holding a table:
  the first cell is the name in 600 over its code and category in muted
  text, then one right-aligned column per measure, a level bar when a
  quantity has a target, a status badge, and a chevron that shows the row
  opens. On a phone the table becomes a list of rows in the same card: name
  over a muted line of the measures, and the key figure in 600 with its
  badge on the right.
- A record's page: a muted breadcrumb, the header with name and one line
  of facts, then two columns on a desk (the main column and a 360px facts
  card): the main column has a card of key figures in a two-up split with
  a notice line under it, then a card of recent changes as rows with a
  tinted icon tile, what happened, who and when. On a phone the columns
  stack and the facts card comes last.
- Forms: a card 680px wide with the title and a lede sentence inside it,
  fields stacked with labels above, short related fields in pairs, choices
  between a few places or plans as selectable tiles that show a current
  figure, and Cancel (quiet) then the primary button at the end, aligned
  right. Beside it on a desk, a 340px card shows what the form will change
  ("After this delivery": the before and after figures). On a phone the
  summary card goes under the form and the primary button is full width.
- Empty, loading and error: empty is a centred block inside the card with
  a 52px rounded icon tile, a 1.25rem heading that names what is missing,
  one or two sentences on what to try, and an outline and a primary button;
  loading is the card with skeleton rows in the table's shape; an error is
  a notice in the destructive tint at the top of the card with what
  happened and what to do, and field errors under their field.

## Components

- Buttons: 40px high on a desk, 48px when docked on a phone. Primary is ink
  with white text; secondary is outline (white with a hairline border);
  tertiary is a ghost button or a 0.8125rem violet text link. An icon
  leads the label only when it helps (Plus for add, Download for export).
- Inputs: 40px, radius-sm, `--input` hairline, focus ring violet 3px at
  low opacity; the search field has its icon inside on the left.
- Segmented filter: a muted track with the selected option as a white
  raised pill; each option carries its count.
- Tables: no vertical lines and no header fill; column headers in muted
  sentence case; rows divided by hairlines; the hovered row on
  `--muted`; numbers right-aligned.
- Badges: pill, 24px, a small dot in the status colour before the word,
  on the status tint ("In stock", "Low", "Out"). Always a word.
- Level bar: a 6px rounded track with the fill in the status colour and a
  tick at the target.
- Icons: lucide at 16px, 1.75px stroke.

## Wording

Friendly, short and confident, written to the customer: "Record delivery",
"No parts match "gate valve"", "Back above the reorder point of 40". Sentence
case everywhere. Dates as "Nov 18", times as "9:42 AM".

## Do and do not

- Do lead every list with three stat cards, the lead one tinted. Do not
  open a screen straight onto a bare table.
- Do keep the list's measures in their own right-aligned columns on a
  desk. Do not run "North 5 · Dock 14" into a sentence on a wide screen;
  that line is only for the phone row.
- Do separate cards with shadow and space. Do not draw borders around
  cards or between sections.
- Do keep one ink primary button per screen and dock it on a phone. Do not
  stretch it across the desktop column.
- Do keep the top bar on a desk. Do not add a sidebar; this theme's
  products have a handful of destinations.

## Tokens

The exact values are in `designs/styles.css` (`:root` and `.dark`), with the
names the kit uses.
