# Editorial design (Editorial theme)

## Summary

A theme for reading and reference: guides, catalogues, journals, field
manuals, collections, a club's records. It should feel like a well-set
printed reference book: serif type does the work, rules replace boxes, and
the page reads before it is operated. This page is the theme's
foundations: read all of it before you draw, and follow it unless the task
says otherwise.

## Direction

- Idea: warm paper, ink-black text, one rubric red, a display serif over an
  old-style text serif, small capitals for labels, hairline rules and no
  rounded corners. A masthead, not an app bar.
- Colour: ink `#1d1a16` for text and the primary button; rubric red
  `#8b2a1b` is the only colour, and it marks remarks that need attention,
  destructive actions and the focus ring. Success and warning tints exist
  for the rare badge but the theme prefers words in the remark column.
- Type: Iowan Old Style for text (Palatino Linotype on Windows), Didot for
  display (Bodoni 72 on Apple, Georgia elsewhere). Old-style figures in
  prose, lining tabular figures in tables.
- Signature: a centred masthead with the product name in the display face
  over a row of section names in small capitals; lists are typeset
  catalogues grouped under section rows; a record reads as an article with
  a margin.

## Palette and roles

| Role             | Light                  | Dark                   | Use                                         |
| ---------------- | ---------------------- | ---------------------- | ------------------------------------------- |
| background       | `#f5f0e6`              | `#16130f`              | the page; there are almost no cards         |
| card             | `#fbf8f2`              | `#1e1a15`              | the rare raised panel: dialogs, menus       |
| foreground       | `#1d1a16`              | `#ece5d8`              | text, headlines, figures                    |
| muted-foreground | `#6c6355`              | `#a89e8d`              | datelines, kickers, captions, column heads  |
| border           | `#d6cbb6`              | `#3a342b`              | hairline rules between rows and sections    |
| primary          | `#1d1a16` on `#f5f0e6` | `#ece5d8` on `#16130f` | the one primary button                      |
| destructive      | `#8b2a1b`              | `#e8907f`              | remarks needing attention, delete, focus    |
| accent           | `#f1e2dc` on `#8b2a1b` | `#3a1f19` on `#f0a898` | selected row, current section underline     |
| success          | `#e4ead9` on `#3f5a26` | `#1f2a17` on `#a9c68a` | a done or received badge when one is needed |
| warning          | `#f3e6c9` on `#7a4f0e` | `#2f240f` on `#e2b866` | a due-soon badge when one is needed         |

Contrast pairs that must hold (WCAG AA or better): foreground on
background (15:1), muted-foreground on background (5.2:1), paper on ink
for the primary (15:1), rubric red on paper (7.5:1), each tint pair (5.7:1
or better). Never set muted text in the display face below 1.5rem.

## Type scale

- Families: `--font-sans: "Iowan Old Style", "Palatino Linotype",
  Palatino, "Book Antiqua", Charter, Georgia, serif` (the token keeps the
  kit's name; in this theme it is the text serif); `--font-display: Didot,
  "Bodoni 72", "Bodoni MT", Georgia, serif`; `--font-mono: ui-monospace,
  "SF Mono", Menlo, Consolas, monospace` for part numbers only. A mockup
  cannot load outside fonts, so these are faces that ship with the
  operating systems: Iowan Old Style and Didot on Apple devices, Palatino
  Linotype and Georgia on Windows. The app may later self-host a text serif
  with true small caps (Source Serif 4 or Newsreader) and a display serif.
- Scale (rem): 3.5 headline (display, 400, line 1.05), 2.75 masthead name
  (display), 1.5 subhead (text, 600), 1.25 standfirst (text, italic or
  400, line 1.5), 1.0625 body (400, line 1.6), 0.875 table text, 0.75
  labels in small capitals (uppercase, 0.1em tracking, 600), which stand
  in for true small caps the system faces lack.
- Figures: `oldstyle-nums proportional-nums` in prose;
  `lining-nums tabular-nums` in tables and key figures. Key figures are
  set large in the display face.
- Measure: prose at most 680px (about 70 characters).

## Spacing and density

- A 4px grid: 4, 8, 12, 16, 24, 32, 48, 72. Generous vertical rhythm:
  48px between sections on a desk, 32 on a phone; 20px side margins on a
  phone.
- Catalogue rows about 44px, with the name in the text face at body size,
  so a screen holds 12 to 15 entries and reads like a page, not a grid.

## Radii and elevation

- `--radius: 0` everywhere: buttons, inputs, dialogs, badges. Nothing is
  rounded.
- No shadows on the page; structure comes from rules: a double rule under
  the masthead, a full rule above each section row, hairlines between
  entries. Dialogs and menus carry a single soft shadow and a hairline.

## Layout

- Wide screens (1024px and up): a centred masthead the full width of the
  page: a dateline in small capitals (the organisation, today's date, the
  person), the product name in the display face, then the main sections as
  a row of small-capital words with the current one underlined in rubric
  red, closed by a double rule. No sidebar and no app bar. The body is a
  centred column: 680px for prose and forms, up to 1040px for a catalogue
  or an article with its margin.
- Narrow screens (under 768px): the masthead shrinks (name about 2.4rem,
  dateline to the organisation only), the section words stay as one row
  that scrolls sideways if it must; no menu button for four or fewer
  sections. A margin column falls below the article.
- Navigation lists only the publication's sections (for example Parts,
  Deliveries, Transfers, Suppliers). A record, a form and sign-in are
  reached from where they belong: an entry's name opens its article, the
  article's margin holds its actions, the dateline's name opens the
  person's account.
- Opening: each list screen opens with a headline and a standfirst that
  says the state in a sentence ("Twelve parts across two warehouses. Four
  sit below their reorder point."), with the search and the primary action
  set beside it on a desk and under it on a phone.
- Lists of records: a typeset catalogue table: a number column (code in
  small mono), the name in the text face, one right-aligned lining-figure
  column per measure, and a Remark column, about 260px, set in italic,
  that says the exception in words in rubric red ("Low; reorder at 40",
  "Out at both"). Entries are grouped under full-width section rows (a
  category or a letter) in small capitals. No status badges, no row
  icons, no chevrons; the name is the link. On a phone the measure columns
  fold into one muted line under the name, and the remark stays.
- A record's page: an article. A kicker in small capitals (category and
  code), the name as the headline, a standfirst that tells the record's
  state in one or two sentences, then the key figures in a row set large
  in the display face with small-capital captions, then "The record": its
  history as a ruled list of dated sentences ("Priya Nair took in 60 at
  North yard. Truck from Harbor Brass."). On a desk a 260px margin column
  sits to the right with Particulars (a definition list) and the actions:
  the primary button, then text links for the rest.
- Forms: a single column at 680px, opened like an article (kicker,
  headline, standfirst). Fields are lines: a small-capital label above, the
  value on a bottom rule with no box. Choices between a few options are
  text radios on one line. The primary button ends the form with Cancel as
  a text link beside it. On a desk the margin holds a note of what the form
  will change ("Afterwards: North yard will hold 77").
- Empty, loading and error: empty is a centred ornament (⁂), a headline-
  sized sentence ("Nothing in the book matches "gate valve"."), a sentence
  on what to try, and a text link with the primary button; loading is the
  catalogue's rules with grey bars where the text will be; an error is a
  rubric-red paragraph under a rule at the top of the column, saying what
  happened and what to do, and field errors in rubric italic under their
  line.

## Components

- Buttons: rectangular, 40px, ink fill with paper text in the text face
  at body size; one per screen. Everything else is a text link underlined
  with a 1px rule offset 3px. Destructive actions are rubric-red text
  links that open a confirmation dialog.
- Inputs: no box; a bottom rule in `--input` that thickens to 2px in
  rubric red on focus. Search is the same line with "Search the book" as
  its small-capital label.
- Tables: column heads in small capitals, muted, over a rule; hairlines
  between entries; section rows with a full rule above and a little space.
- Badges: only when a word in the remark column cannot do the job; then a
  square tint with the word in small capitals.
- Figures: a key figure is the number large in the display face over a
  small-capital caption, with its context in muted italic.
- Icons: none in lists and headings; a lucide icon only inside a button
  where a word alone is ambiguous.

## Wording

Written, not labelled: whole sentences in standfirsts, history and empty
states, in the voice of a careful editor. "Record a delivery", "Nothing in
the book matches", "Seventeen on hand against a reorder point of forty".
Dates as "Wednesday the 18th" in prose and "Nov 18" in tables.

## Do and do not

- Do group a long list under section rows and say exceptions in a remark
  column. Do not decorate entries with coloured pills, icons or cards.
- Do open every screen with a headline and a standfirst that tells the
  state. Do not open on a toolbar.
- Do use rules for structure. Do not draw boxes, rounded corners or
  shadows on the page.
- Do keep one ink button and make every other action a text link. Do not
  line up a row of filled buttons.
- Do let a record read as an article with a margin on a desk. Do not split
  it into a dashboard of cards.

## Tokens

The exact values are in `designs/styles.css` (`:root` and `.dark`), with the
names the kit uses.
