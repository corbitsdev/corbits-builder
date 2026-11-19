# Building this app

A Bun workspace with three packages. Keep each kind of code in its place:

- `client/`: the UI. Vite, React, React Router, TanStack Query, Tailwind CSS v4 and `@corbits/react-ui`. It talks to the server only over HTTP at `/api`.
- `server/`: the API. Hono on Bun. Every route lives under `/api`. Static data the app ships with goes in `server/src/data/*.json`; data people create goes through `createStore`.
- `packages/shared/`: zod schemas for what crosses the wire. The server builds a response from a schema and the client parses it with the same one (see `Health` and `getJson`). Nothing else goes here.

## Where things are

The starter is small, so this map stands in for reading it:

- `client/src/routes.tsx` lists every route inside `components/layout.tsx`, the header and navigation. `pages/home.tsx` is a placeholder to replace; `pages/not-found.tsx` and `pages/error.tsx` stay. `client/src/api.ts` holds `getJson`, `sendJson` and the queries; `client/src/styles.css` imports Tailwind and the kit's theme.
- `server/src/index.ts` is the Hono app and its routes; `server/src/store.ts` is `createStore`; `server/src/client.ts` serves the built client.
- `packages/shared/src/index.ts` holds the wire schemas, `Health` among them.
- `.builder/DESIGN.md` names each screen with its mockup page in `.builder/designs/screens/`; `.builder/designs/styles.css` opens with the design's `:root` and `.dark` tokens.

## How screens are built

- Data: one `useQuery` per resource in `client/src/api.ts`, fetching with `getJson` and the shared schema.
- Every screen that shows data renders it through `QueryState` (`client/src/components/query-state.tsx`): it shows the loading skeleton, the error with a retry button, and the empty state you pass, so none is forgotten.
- Changes: a `useMutation` that calls `sendJson` and, on success, invalidates the queries it changed and calls `toast("…")` from `@corbits/react-ui/ui/toast`. A failed save already shows its error as a toast.
- The server keeps the app's data with `createStore` (`server/src/store.ts`): JSON under `server/data`, validated and written one change at a time. Routes validate request bodies with the shared schemas and answer `{ error }` with a 4xx status when they are wrong.
- `.builder/DESIGN.md` and the mockup in `.builder/designs` are the approved design: use its screens, copy and `data-testid` values exactly. Where the mockup fakes an interaction or a result, build the real behaviour `DESIGN.md` names.

## How sign-in is built

Every app with sign-in opens with a demo account, so whoever tries the app can always sign in. `server/src/data/demo-account.json` holds its email and password, and Live Preview shows them beside the app. Once the server has its account store, seed it with one line in `server/src/index.ts`:

```ts
await seedDemoAccount({ has: (email) => /* the store has this email */, create: (account) => /* add it, hashing its password as every account's is */ });
```

`seedDemoAccount` (`server/src/demo-account.ts`) creates the account on first run and leaves it as it is after, outside production only: its password is in the repository, so under `bun run start`, which sets `NODE_ENV=production`, it creates nothing. Call it unconditionally and leave that check to it. A published app therefore starts with no account, so it needs a way for its first person to get one, such as signing up. Name the demo account in `README.md` as one for development, and say there how the first account is made in production. An app without sign-in deletes `server/src/demo-account.ts` and `server/src/data/demo-account.json`.

Use components from `@corbits/react-ui` before writing your own; its theme tokens (`bg-background`, `text-foreground`, `text-muted-foreground`, `border-border`, `bg-primary`) style everything else.

Commands, run from the root:

- `bun run typecheck` checks every package.
- `bun run build` builds the client.
- `bun run start` serves the built client and the API on `PORT`; `check-app` runs it for you.
- A package belongs to the one workspace package that imports it: `client`, `server` or `packages/shared`.
- The saved code must install from its `bun.lock` as it is, because the next workspace is prepared with a frozen install, so never edit dependencies in a `package.json` by hand; the check fails until `bun.lock` matches.

## Checking the app

`check-stack` runs each command in `CHECKS.txt` in order, then `check-app` from `BUILDER-CHECKS.txt`, and stops at the first that fails, with its output. It takes up to two minutes, so run it with a run_shell timeout of 120000. `CHECKS.txt` holds the project's own commands, a frozen install, the typecheck and the build, which Builder also runs on the saved code; add `bun test` there once you write tests. `check-app` exists only in this workspace, so it stays in `BUILDER-CHECKS.txt`.

`check-app` checks the app the way it ships, in a browser. It:

1. runs `bun run build`, then `bun run start` on a free `PORT`, and waits for the server to answer;
2. opens `/` in a headless browser at 1280 px and 390 px, follows every same-origin link it finds, and loads each page by its own URL, the way a person opening a link or refreshing does;
3. fails on an uncaught error, a console error, a failed request or any response of 400 or more, a request that leaves the app, a page with no text, content wider than the screen, text off screen, a control spilling out of its box, or navigation that hides its links.

So once it passes, do not open pages yourself to see that they load, show no errors or fit both widths. It does not use features: prove a requirement that works through the server with a test against the server's API, kept beside the route it tests and run by `bun test` in `CHECKS.txt`, and use the browser tools only to find why a check failed or to try a flow that only a browser shows, such as a drag, a file picker or a dialog's steps.

`app_status` starts the app's dev server, which then reloads as files change, and gives its address and the server log; the browser tools open that address. Keep throwaway files, such as screenshots, under `.scratch/`; nothing there is part of the app.

## The app's README

`README.md` replaces the starter's placeholder and describes the app as built, for whoever installs and runs it (an installer, a sysadmin, an IT person): what it is; how to run it in development and in deployment; every environment variable and any `.env` file, with what each value is and where it comes from; the seed file or first-run step, when there is one; what it needs from the systems around it (database, mail, accounts, network, credentials) and what must be declared or configured there; how to tell it is running; and how its code is laid out. It refers to "the address the server prints" for where the app runs. A script the README or a `package.json` tells anyone to run directly starts with a shebang line and is committed executable (`chmod +x`, then `git add --chmod=+x`), so it runs as unpacked.

The app is done when every item of the build plan's acceptance checklist is proven, `ACCEPTANCE.md` records the check or what you did and saw for each, and `check-stack` passes after the last change you made.

## What stays as it is

These starter files already work and are what the check relies on; build around them:

- `server/src/client.ts` serves the built client and answers every non-API path with `index.html`.
- `server/src/store.ts`, `client/src/components/query-state.tsx` and the `scripts` in each `package.json`.
- `BUILDER-CHECKS.txt`.

Ports and hosts come from the environment, and paths are relative to the app. Data the app fetches from an outside service is requested by the server or the client exactly as that service documents it.
