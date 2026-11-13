# @corbits-builder/plugin-ui

The pieces a plugin's screen view draws with, on the interface's own components
and tokens, so every screen reads alike. Each is its own entry point.

- `screen-card`: `ScreenCard`, a question's framed card, and `ScreenSettled`,
  the one quiet line it leaves once answered.
- `screen-actions`: `ScreenActions`, a question's row of actions with the
  host's Cancel.
- `document-block`: `DocumentBlock`, a filed document as the person meets it
  anywhere: its title, which opens it, its version, and its own summary, or a
  way to read it when it has none. Use it wherever a view shows a document, so
  one put up for approval and one simply handed back finished read the same.
- `comparison`: `Comparison`, things the person weighs side by side and picks
  one of.
- `steps`: `Steps`, a list of steps and where each stands.
- `markdown`: `Markdown`, a passage of model-written markdown rendered safely,
  and `DocumentView`, a whole document read for itself.
