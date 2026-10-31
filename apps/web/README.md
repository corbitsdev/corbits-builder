# Interface

The Builder interface: a Vite and React single-page app where a person signs
in, talks with a project's coordinator, reads and approves documents, picks a
design and watches the app being built.

## Where it fits

The interface reaches the hub only through its HTTP API, using the typed
client in [`packages/client`][client] and the shared types in
[`packages/schemas`][schemas]. It never imports the hub, Postgres or
Drizzle; `tests/integration/architecture.test.ts` fails on that. In
development Vite proxies `/api` to the hub at `UI_HUB_ORIGIN`; a deployed hub
serves the built `dist/` on its own origin.

## Layout

- `src/main.tsx`, `src/App.tsx`: the entry and the top-level screens.
- `src/config.ts`: the product name and every piece of user-visible wording.
- `src/pages/`: sign-in, the project library, settings and providers;
  `pages/workspace/` is the open project (conversation, documents, design
  concepts, live app).
- `src/client.ts` and `src/api/`: the `api` object the screens call, built on
  the typed client and the hub's routes.
- `src/queries/`: TanStack Query keys and the shared query client.
- `public/mockup-frame.html`: the sandboxed page design mockups render in.
- [`DESIGN.md`][design]: the workspace layout and styling contract.

## Working on it

`bun run dev` starts the hub and this interface with live reload; the dev
server reads `UI_PORT` and `UI_HUB_ORIGIN` from `.env.web`, copied from
`.env.web.example`. Put new user-visible wording in `src/config.ts`.
`bun run check` lints, formats, typechecks and tests it with the rest of the
repo. Setup is in [CONTRIBUTING.md][setup].

[client]: https://github.com/corbitsdev/corbits-builder/tree/main/packages/client
[schemas]: https://github.com/corbitsdev/corbits-builder/tree/main/packages/schemas
[design]: https://github.com/corbitsdev/corbits-builder/blob/main/apps/web/DESIGN.md
[setup]: https://github.com/corbitsdev/corbits-builder/blob/main/CONTRIBUTING.md#setup
