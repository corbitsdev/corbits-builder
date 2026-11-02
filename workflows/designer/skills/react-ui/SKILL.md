---
name: react-ui
description: Use before hand-writing any UI - which @corbits/react-ui component to use for app shell, pages, forms, tables, stats, charts, status, empty and loading states; install, theme tokens, dark mode and extra packages.
---

# @corbits/react-ui (0.5.0)

The client starter pins `@corbits/react-ui` 0.5.0. Components take props and
render markup; data comes from the app's queries. Styling is Tailwind v4 classes backed by
theme tokens, so everything inherits light and dark mode and the same
spacing, radius and type.

Rule: build every part from a kit component found in these reference
files, and write your own only for what the kit lacks. The files are the
kit's documentation, props included.

## Files

- `reference/layout.md`: page frame, top bar, sidebar, list/detail, sections,
  settings, cards. Read before building any screen's structure.
- `reference/controls.md`: buttons, inputs, selects, switches, tabs, filters,
  dialogs, menus, toasts.
- `reference/data-display.md`: tables, stat tiles, charts, badges, status
  dots, avatars, empty and loading states.
- Exact props of every exported component, generated from the installed
  package, one file per group: `reference/api-layout.md` (app shell and page
  layout), `reference/api-controls.md` (buttons, inputs, filters, dialogs,
  menus, toasts), `reference/api-data-display.md` (tables, stats, charts,
  status, avatars, empty and loading states) and `reference/api-agent.md`
  (conversation, agent runs, media and artifacts).
- `reference/theming.md`: install, stylesheet choice, tokens, dark mode,
  fonts, subpath imports and extra packages.

## In a design mockup

The mockup lives in `.builder`: `DESIGN.md`, `designs/styles.css`,
`designs/index.html` (the app shell and navigation) and one
`designs/screens/<name>.html` file per screen. It is plain HTML and CSS: pick the kit
component for each part from these references, write its markup by hand with
the tokens and base component classes in `styles.css`, and name the component
in the `DESIGN.md` components table so the coder builds it from the kit. The
import rules below are for the app.

## Import rules

- Import from the package root: `import { Button } from "@corbits/react-ui"`.
- These modules need an extra package and are imported by subpath, so check
  `client/package.json` before using them: `ui/dialog`, `ui/command-palette`
  and `ui/sidebar-search` (`@radix-ui/react-dialog`), `ui/menu`
  (`@radix-ui/react-dropdown-menu`), `ui/tooltip` (`@radix-ui/react-tooltip`),
  `ui/toast` (`sonner`, already in the starter). The starter does not ship
  the Radix packages; adding one is a package install.
- In the app, the client starter already imports `theme.css` in
  `client/src/styles.css`, mounts `ThemeProvider` and `Toaster` in
  `main.tsx`, and has a top-bar `Layout`.
- Use theme tokens for colour: `bg-background`, `text-foreground`,
  `text-muted-foreground`, `border-border`, `bg-card`, `bg-primary`.
- Links go through the router: components with `asChild` (`Button`,
  `SidebarItem`) take a React Router `Link` as the child.
