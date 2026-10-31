# Building this app

A Bun workspace with three packages. Keep each kind of code in its place:

- `client/`: the UI. Vite, React, React Router, TanStack Query, Tailwind CSS v4 and `@corbits/react-ui`. It talks to the server only over HTTP at `/api`.
- `server/`: the API. Hono on Bun. Every route lives under `/api`. Static data the app ships with goes in `server/src/data/*.json`; data people create goes through `createStore`.
- `packages/shared/`: zod schemas for what crosses the wire. The server builds a response from a schema and the client parses it with the same one (see `Health` and `getJson`). Nothing else goes here.

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

`seedDemoAccount` (`server/src/demo-account.ts`) creates the account on first run and leaves it as it is after. Name the demo account in `README.md`. An app without sign-in deletes `server/src/demo-account.ts` and `server/src/data/demo-account.json`.

Use components from `@corbits/react-ui` before writing your own; its theme tokens (`bg-background`, `text-foreground`, `text-muted-foreground`, `border-border`, `bg-primary`) style everything else.

Commands, run from the root:

- `bun run typecheck` checks every package.
- `bun run build` builds the client.
- `bun run start` serves the built client and the API on `PORT`; `check-app` runs it for you.
- A package belongs to the one workspace package that imports it: `client`, `server` or `packages/shared`.

## Checking the app

`check-app` checks the app the way it ships. It takes up to two minutes. It:

1. fails when `README.md` is missing, still the starter's placeholder, or names a local port or machine path, and, once a `docs/USER-MANUAL.md` is written, the same for the manual and when it shows no picture from `docs/manual/`;
2. runs `bun run typecheck` and `bun run build`, then `bun run start` on a free `PORT`, and waits for the server to answer;
3. opens `/` in a headless browser at 1280 px and 390 px, follows every same-origin link it finds, and loads each page by its own URL, the way a person opening a link or refreshing does;
4. once a manual is written, saves a 1280 px picture of each page it opens as `docs/manual/<page>.png` (`/` is `home.png`, `/board/new` is `board-new.png`), draws each highlight the manual names, and lists every picture it saved;
5. fails on an uncaught error, a console error, a failed request or any response of 400 or more, a request that leaves the app, a page with no text, content wider than the screen, a highlighted element it cannot find, or a picture the manual shows that is not there after capture.

It does not try features: confirm each requirement in the running app, against the acceptance checklist and the design.

The app's dev server runs while you build and reloads as files change; `app_status` gives its address and the server log. Use the browser tools on that address to try features the way a person would.

## The app's documents

The app ships `README.md`, and a `docs/USER-MANUAL.md` when the person asks for one after the build. Both describe the app as built. Write them once the features work, and update them whenever a later change alters what they describe:

- `README.md`, for whoever installs and runs the app (an installer, a sysadmin, an IT person): what it is; how to run it in development and in deployment; every environment variable and any `.env` file, with what each value is and where it comes from; the seed file or first-run step, when there is one; what it needs from the systems around it (database, mail, accounts, network, credentials) and what must be declared or configured there; how to tell it is running; and how its code is laid out. A script the README or a `package.json` tells anyone to run directly starts with a shebang line and is committed executable (`chmod +x`, then `git add --chmod=+x`), so it runs as unpacked.
- `docs/USER-MANUAL.md`, only when the person asks for it, for the people who use it, who are not developers: clear, plain, non-technical prose, one section per screen and per task, saying what the person sees and what to do. Illustrate it with the pictures `check-app` saves, each referenced with a caption: `![The board](manual/board.png)`. To point at the area or button a step refers to, reference a picture named after its page plus a word of your own, titled `highlight:` with a CSS selector and, after a bar, the text the element shows: `![Adding a card](manual/board.new-card.png "highlight: button | New card")`. `check-app` captures that page with a bright rounded outline and a short label around the first visible match.

`README.md` replaces the starter's placeholder. Both documents refer to "the address the server prints" for where the app runs.

The app is done when every item of the build plan's acceptance checklist works in the running app, `ACCEPTANCE.md` records what you did and saw for each, `README.md` describes it, and `check-app` passes after the last change you made.

## What stays as it is

These starter files already work and are what the check relies on; build around them:

- `server/src/client.ts` serves the built client and answers every non-API path with `index.html`.
- `server/src/store.ts`, `client/src/components/query-state.tsx` and the `scripts` in each `package.json`.

Ports and hosts come from the environment, and paths are relative to the app. Data the app fetches from an outside service is requested by the server or the client exactly as that service documents it.
