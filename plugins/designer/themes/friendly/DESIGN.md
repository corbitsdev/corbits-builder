# Friendly design (Friendly theme)

## Summary

A theme for consumer and personal apps: habits, bookings, orders, a
household's chores, a small club's sign-ups. It should feel warm, easy and
encouraging, like an app a person is glad to open on their phone: big
soft shapes, larger type, plain kind words. It is designed for the phone
first; the desk is the same cards in a wider grid. This page is the
theme's foundations: read all of it before you draw, and follow it unless
the task says otherwise.

## Direction

- Idea: warm cream, white cards with big radii, one cheerful coral, a
  humanist sans at a large size, tinted icon tiles, and a greeting at the
  top of the home screen.
- Colour: coral `#c94322` fills the primary button and the current tab;
  its pale tint `#ffe4d6` marks chips that are on and the person's own
  things. Status uses green, honey and red tints, always with a word.
- Type: Seravek on Apple devices (Segoe UI Variable Text on Windows,
  Roboto on Android) for everything, at a 17px body. Headings heavy (700),
  labels 600.
- Signature: records are cards with a tinted icon tile and two big
  numbers; on a phone the main action floats above a bottom tab bar.

## Palette and roles

| Role             | Light                  | Dark                   | Use                                            |
| ---------------- | ---------------------- | ---------------------- | ---------------------------------------------- |
| background       | `#fff6ec`              | `#1c1410`              | the page                                       |
| card             | `#ffffff`              | `#261c17`              | every card, the tab bar, the search field      |
| foreground       | `#2b1d16`              | `#fbeee4`              | text and numbers                               |
| muted-foreground | `#806b5f`              | `#c4ad9f`              | second lines, captions, inactive tabs          |
| border           | `#f1e2d4`              | `#3a2c24`              | the rare divider inside a card                 |
| primary          | `#c94322` with white   | `#ff7a52` on `#1c1410` | primary button, current tab, focus ring        |
| secondary        | `#ffe9d9` on `#6b2c14` | `#3a271d` on `#ffd9c4` | soft buttons such as Clear search or Move some |
| accent           | `#ffe4d6` on `#b13d1c` | `#3d2418` on `#ffb397` | chips that are on, selected tiles              |
| success          | `#def5e4` on `#23703f` | `#173322` on `#8fe0a8` | plenty, done, confirmed                        |
| warning          | `#fff0c2` on `#8a5a00` | `#3a2c0a` on `#ffd166` | running low, soon                              |
| destructive      | `#d93a3a` with white   | `#ff8a80` on `#1c1410` | all gone, cancelled, delete                    |

Contrast pairs that must hold (WCAG AA or better): foreground on
background (15:1), muted-foreground on card (5:1) and on background
(4.7:1), white on primary (4.9:1), secondary and accent pairs (4.9:1 or
better), each status pair (5.2:1 or better), white on destructive (4.6:1).
Never put coral text on cream at body size; it is for fills.

## Type scale

- Families: `--font-sans: Seravek, "Avenir Next", "Segoe UI Variable
  Text", "Segoe UI", Roboto, system-ui, sans-serif`; `--font-mono:
  ui-monospace, "SF Mono", Menlo, Consolas, monospace`, which this theme
  barely uses. A mockup cannot load outside fonts, so these are faces that
  ship with the operating systems: Seravek on Apple devices, Segoe UI on
  Windows, Roboto on Android. The app may later self-host a warm rounded
  or humanist sans such as Nunito, Figtree or Plus Jakarta Sans.
- Scale (rem): 1.75 greeting and page title (700, -0.01em), 1.25 card
  title on a record page (700), 1.0625 body and card name (600 for names,
  400 for text, line 1.5), 0.9375 secondary line, 0.8125 chip and pill
  (600), 2 the big numbers on a card (700), 3 the hero number on a record.
- Figures: tabular in counts; no mono for codes, which are shown small in
  muted text if at all.

## Spacing and density

- A 4px grid: 4, 8, 12, 16, 20, 24, 32, 48. Card padding 16 on a phone, 20
  on a desk; 12px between cards on a phone, 16 on a desk; 20px page margin
  on a phone.
- Low density on purpose: a phone shows four to six cards; touch targets
  are 48px or more. A person with hundreds of records needs Workbench, not
  this theme.

## Radii and elevation

- `--radius: 1.25rem` for cards, `--radius-sm: 0.875rem` for inputs, tiles
  and icon squares, `--radius-lg: 1.75rem` for hero cards and sheets.
  Buttons, chips, pills, the search field and the desk nav are fully
  rounded.
- Cards sit on a warm soft shadow (a faint line and a long blur tinted
  brown), never a grey border. The floating action carries a stronger
  coral-tinted shadow.

## Layout

- Narrow screens first (under 768px): a top row with the product's logo
  tile and name, a bell and the person's initials in a round avatar; a
  bottom tab bar on white with three or four destinations, each an icon
  over a label, the current one in coral. The home screen opens with a
  greeting ("Morning, Priya") and one sentence of what needs doing, then a
  52px rounded search field, then a row of filter chips that scrolls
  sideways. The primary action floats, full width minus the margins and
  56px high, just above the tab bar.
- Wide screens (1024px and up): the same top row, with the destinations
  moved into it as a rounded segmented control (current item filled with
  the foreground colour); no tab bar and no floating action, which
  returns to the page header beside the greeting. Content is centred at
  most 1120px wide.
- Navigation lists only the places a person goes (for example Home,
  Bookings, Profile). A record, a form and sign-in are reached from where
  they belong: a card opens its record, a button on the record opens its
  form, the avatar opens the profile and sign-out.
- Lists of records: cards. Each card has a 44px tinted icon tile for the
  record's kind and its status pill at the top, then the name (600), a
  small muted code or detail, and the one or two numbers that matter, each
  large with a short label ("17 North yard", "3 Dock"). On a phone each
  card is a compact row: icon tile, name over a muted line, and the pill
  on the right. On a desk the cards form a grid of four columns (three
  under 1280px). A short heading such as "All parts" sits above the grid.
- A record's page: a "Back" link with an arrow, then a hero card: icon
  tile and pill, the name as the title, a muted line of facts, the big
  numbers side by side, a meter with a plain sentence under it ("17 of 40
  you like to keep. 60 more arrive on Wednesday."), and the primary and a
  soft button. Then a card "What happened lately": a list where each line
  is a round initials avatar and a sentence ("Priya took in 60 · North
  yard") with a small muted time. On a desk the two cards sit side by
  side, hero wider.
- Forms: one card, asking in plain questions, one thing at a time: "Where
  did it arrive?" as two big choice tiles that show a current figure,
  "How many?" as a stepper with large minus and plus buttons, short text
  fields in a pair. The primary button is full width and names the result
  ("Add 60 to North yard"). Cancel is the Back link above the card. On a
  desk the card is 560px wide and centred.
- Empty, loading and error: empty is a centred soft blob with a 44px icon,
  a warm heading ("No "gate valve" on the shelves"), a kind sentence, the
  primary button and a soft one; loading is cards with pale shimmer bars;
  an error is a warning-tinted card that says what happened in plain words
  and offers "Try again", and field errors in red under their field with a
  short fix.

## Components

- Buttons: 48px, fully rounded, 600 at body size. Primary is coral with
  white text; soft is the secondary tint; a text button is coral 600.
  Primary buttons carry a plus or the action's icon at 20px.
- Inputs: 52px, `--radius-sm`, white with a 1.5px `--input` border that
  turns coral on focus; labels above in 600.
- Chips: fully rounded, 36px, white with a border; on is the accent tint
  with accent text. Counts sit in the chip ("Running low · 3").
- Pills: fully rounded tint with the status word in plain language
  ("Plenty", "Running low", "All gone").
- Icon tiles: a rounded square tinted per kind of record, with a lucide
  icon at 20px; the same kind always gets the same tint.
- Meter: a 10px fully rounded track with a coral or status fill and a
  sentence under it rather than a number alone.
- Icons: lucide at 20px (22 in the tab bar), 2px stroke.

## Wording

Warm, plain and second person, like a helpful friend: "Morning, Priya",
"3 parts could use a top-up today", "A truck came in? Let's count it in.",
"All gone" rather than "Out of stock". Short sentences, no jargon, no
codes in headings. Times as "Today, 9:14".

## Do and do not

- Do show records as cards with an icon tile, a pill and big numbers. Do
  not use a dense table; if the person needs one, this is the wrong theme.
- Do float the primary action above a bottom tab bar on a phone. Do not
  hide the main action in a menu.
- Do ask form questions in plain words with tiles and steppers. Do not
  show a grid of bare labelled inputs.
- Do give the desk the same cards in a four-column grid with the nav in
  the top row. Do not stretch one phone column across a wide screen.
- Do keep corners big and shadows warm. Do not mix in square corners or
  grey hairline boxes.

## Tokens

The exact values are in `designs/styles.css` (`:root` and `.dark`), with the
names the kit uses.
