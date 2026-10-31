# react-ui: install, theme and tokens

Source: @corbits/react-ui 0.4.0 npm package (README.md, dist/theme.css, dist/ui/theme-provider.d.ts), the version pinned in workflows/coder/starter/client/package.json
Fetched: 2026-10-29

---

## Install and stylesheet

Peers: `react`, `react-dom`, `lucide-react`, `@radix-ui/react-slot`. Optional
peers only for the subpath modules (see SKILL.md). The package is side-effect
free apart from its CSS.

Import exactly one stylesheet at the app root:

- `@corbits/react-ui/styles.css`: includes Tailwind preflight and a base
  layer; restyles the page. For apps without Tailwind.
- `@corbits/react-ui/theme.css`: tokens and Tailwind v4 `@theme inline`
  mapping, no preflight. For apps that already run Tailwind v4 (the starter).
  The starter's `client/src/styles.css`:

```css
@import "tailwindcss";
@import "@corbits/react-ui/theme.css";
```

Without either, components render unstyled.

## Tokens

Each token is a CSS variable and a Tailwind colour utility
(`bg-background`, `text-muted-foreground`, `border-border`, `ring-ring`):

`background`, `foreground`, `card`, `card-foreground`, `popover`,
`popover-foreground`, `primary`, `primary-foreground`, `primary-active`,
`primary-emphasis`, `secondary`, `secondary-foreground`, `muted`,
`muted-foreground`, `accent`, `accent-foreground`, `success`,
`success-foreground`, `destructive`, `destructive-foreground`, `border`,
`border-strong`, `input`, `ring`, `ok`, `warn`.

Other variables: `--radius` (0.5rem), `--font-sans`, `--font-mono`,
`--duration-micro` (150ms), `--duration-standard` (200ms),
`--duration-large` (300ms), icon sizes `--icon-size-nav`, `-topbar`,
`-button`, `-checkbox`. Light defaults: background `#ffffff`, foreground
`#2b2627`, primary `#e98428`, border `#dfe3e6`. Dark defaults: background
`#000000`, foreground `#e4d5bc`, primary `#bf6b20`.

App code colours everything with the utilities. Override a token only in
`styles.css`, once, for the whole app.

## Dark mode

Dark mode is a `.dark` class on an ancestor. With neither `.dark` nor `.light`
on the root, tokens follow `prefers-color-scheme`. `dark:` utilities need a
`.dark` ancestor. `ThemeProvider` (mounted in the starter with
`defaultMode="light"`) toggles `.dark`/`.light`, persists the choice under
`storageKey` (default `corbits-theme`), and sets `color-scheme`.
`ThemeProvider` props: `storageKey`, `defaultMode`, `defaultPreset`, `root`.
Presets (`default`, `warm`, `cool`) apply as `data-theme`. `useTheme()` returns
`mode`, `setMode`, `cycleMode`, `resolvedMode`, `preset`, `setPreset`.

To avoid a dark first paint for a stored light choice on a dark OS, add
`.light` to `<html>` before first paint when the stored choice is light.

## Fonts

The theme names Red Hat Display and Space Mono but does not bundle them.
Load them (for example from Google Fonts in `index.html`) or the stack falls
back to system fonts. Override `--font-sans` / `--font-mono` for a face loaded
under another name.

## Requirements

Node 24 or later to install; React 18.2+ (tested on 19). Icons come from
`lucide-react`.
