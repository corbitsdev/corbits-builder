# A serverless host

A serverless host runs the app's code only while it answers a request, in many copies at once, on machines with no disk the app can keep anything on. Nothing the app does between requests survives, and nothing it writes to a file is there for the next request. Everything in the publish pack still holds; this pack says what changes.

## One app, two entries

Keep the app runnable on Bun, because Live Preview and `bun run dev` run it there, and add a second entry for the host. Both entries serve the same Hono app and the same storage interface, so no route knows where it runs.

- `server/src/app.ts`: the Hono app and every `/api` route, moved here from `index.ts`, ending with the JSON 404 for an unknown `/api` path, which the host's entry needs since it never loads `client.ts`. It imports nothing made for Bun, Node's server or the disk. The host's pack gives its skeleton.
- `server/src/index.ts`: the Bun entry. It chooses the file storage, seeds the demo account, serves the built client with `serveClient`, and `export default app` as before. `stack.run` and `bun run start` keep using it. `serveClient` adds its own JSON 404 for `/api`, after the one in `app.ts`, so it is never reached; leave it, since `client.ts` stays as it is.
- `server/src/worker.ts`: the host's entry. It exports the handler the host calls with each request, chooses the host's database as storage, and passes the request to `app.fetch`. It never imports `index.ts`, `client.ts`, the file storage or `demo-account.ts`, and never seeds the demo account.

## Where this pack overrides the starter's AGENTS.md

The starter's `AGENTS.md` describes the app on Bun alone. When the app is made to run on a serverless host, this pack and the host's pack override it where they differ, and only there:

- `server/src/index.ts` is no longer "the Hono app and its routes": the routes move to `server/src/app.ts`, and `index.ts` becomes the Bun entry above.
- `server/src/store.ts` does not stay as it is: it becomes the storage module below, and the starter's JSON files under `server/data` move behind it, for the Bun entry.
- `server/package.json` gains the `build` script the host's pack gives; its other scripts stay as they are.
- `BUILDER-CHECKS.txt` gains the `check-serverless` line below; `check-app` stays.

`server/src/client.ts` still stays as it is, and everything else in the starter's `AGENTS.md` still holds.

## Answering requests

The host calls an exported handler for each request; the app never listens on a port, never calls `Bun.serve` or `.listen()`, and never starts anything that runs between requests. Work after the response, such as sending an email, goes through what the host gives for it, not a timer.

## No disk at run time

Nothing is read from or written to the local disk while the app runs: no `node:fs`, no `Bun.file`, no `Bun.write`, no SQLite file, no uploads folder. Data the app ships with is imported as a module (`import countries from "./data/countries.json"`), so the bundle carries it.

## Static files

The host serves the built client from its folder by itself, with every path that is not a file answered by `index.html`, and sends only `/api/*` to the worker. The worker never serves files.

## Data people enter

Data people enter moves to the host's database through one small storage module, so the rest of the app does not change. Keep `createStore(name, schema, initial)` with its `read` and `update` exactly as the routes use them, and put behind it a storage the entry chooses:

- `server/src/store.ts`: `createStore` and `useStorage(storage)`, where a storage reads a collection by name and updates it with a change function. It validates with the schema as before.
- `server/src/storage/files.ts`: the JSON files under `server/data`, written one change at a time, for the Bun entry.
- the host's storage, in its own file, for the worker entry; the host's pack says how.

Each entry calls `useStorage` before the app answers: the Bun entry once at start, the worker entry at the start of each request, since the host hands it the database with the request.

## No state between requests

A module-level variable is empty in a new copy and is not shared between copies: never keep sessions, counters, caches people rely on, or queues in one. Keep them in the database, or sign them into a cookie. Because several copies run at once, an in-process queue does not stop two requests from overwriting each other; the storage makes each update check that nothing changed since it read.

## Limits per request

Each request has a short time and memory limit, and a cap on calls to other services. Keep each request's work small: no long loops over every record, no large files held in memory, no waiting on slow work. Hash a password with the Web Crypto API (`crypto.subtle`), not `Bun.password`.

## Secrets and settings

Secrets and settings arrive as the host's bindings or variables, set where the app is published, never in the code or a file. The host's pack says how the worker reads them; the Bun entry keeps reading them from `process.env`. `NODE_ENV` is `production` on the host, so code that checks it behaves as published. The demo account never reaches the host because the worker's code never contains it, not because of `NODE_ENV`: keep `demo-account.ts` out of everything `worker.ts` imports.

## Proving it

Add `check-serverless <entry>` as a line of `BUILDER-CHECKS.txt`, after `check-app`, once the worker entry exists, naming the module the host runs from the app's root: the built one, such as `check-serverless server/dist/worker.js`, or its source when the host builds it. It bundles the worker for a browser-like runtime and names each file that reaches the disk, uses Bun or listens on a port. After the entry, name each module scheme the host provides of its own, such as `cloudflare:`. The pack for the host says which file that is and which schemes it provides. `check-app` keeps proving the Bun entry, so both entries are checked every time you finish. Then say in `README.md` how the app runs on the host and how it still runs on Bun.
