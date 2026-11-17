# @corbits/react-ui (0.5.1)

The client starter pins `@corbits/react-ui` 0.5.1. Components take props and
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
