# Building Builder's interface

Builder is one product and every part of it should feel the same. A new
setting, button, page, document view or agent interaction looks and behaves
like what is already there, and extends it rather than standing beside it.
[DESIGN.md](./DESIGN.md) is the workspace design contract.

## Before adding anything

- Check what the surrounding interface already offers, and extend that. Never
  add a second way to do something the interface already does.
- Build with `@corbits/react-ui` components and the existing design tokens
  first, so everything keeps the same theme and brand. Add no new colours,
  spacing, type scales or one-off styles.
- Build a new component or area that isn't specific to Builder, such as a
  richer table, here first, matching the rest of the interface. Note on the
  issue and the pull request that it may fit better in `@corbits/react-ui`;
  maintainers decide whether it moves.
- Wording lives in the interface's config.

## Every artifact kind is a first-class document

A new kind (a sheet, a deck, a diagram) is integrated everywhere a document
is, not shown as a standalone widget:

- **Tab:** it opens as a tab in the document pane. The tab names it, so the
  view adds no second title and no outer margin; content sits flush.
- **Floating bar:** every action on it (download, share, search, filters,
  copy, quote, versions, compare) goes in the document pane's one floating
  bar, supplied by the view. Views draw no toolbars, inline links or buttons
  of their own.
- **Tab menu:** per-document commands that aren't everyday actions, such as
  print, go in the tab's context menu next to the existing items.
- **Quote:** whatever the person points at, whether a passage, a cell range or
  a slide element, can be quoted into their message through the existing quote
  offer, naming the document, the version and the location.
- **Versions and changes:** the version menu and comparison work for it, or
  say plainly why a version can't be compared.
- **States:** loading, empty and error states are the same short status
  lines every document uses.
