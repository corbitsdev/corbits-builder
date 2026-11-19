# Cloudflare Workers

Cloudflare Workers is a serverless host: the serverless pack holds, including where it overrides the starter's `AGENTS.md`, and this pack says how it is done on Workers. The app keeps its Bun entry for Live Preview and gains `server/src/app.ts` and `server/src/worker.ts`, the second built into one module that Cloudflare runs. `d1-store.md` in this pack has the storage code to copy.

## Converting the starter

In this order:

1. Move every route from `server/src/index.ts` into `server/src/app.ts`, written as below.
2. Replace `server/src/store.ts`, add `server/src/storage/files.ts` and `server/src/storage/d1.ts`, rewrite `server/src/index.ts` and add `server/migrations/0001_collections.sql`, all as `d1-store.md` gives them. An app with sign-in keeps its `seedDemoAccount` line in `index.ts`, after `useStorage`.
3. Add `server/src/worker.ts`, as in The worker entry below.
4. Add `wrangler.jsonc` at the app's root.
5. Add the `build` script to `server/package.json`, as in The build below.
6. Add `check-serverless server/dist/worker.js cloudflare:` as the last line of `BUILDER-CHECKS.txt`.
7. Run `bun run typecheck` and `bun run build`, then check the built worker as Checking it here says.
8. Add the README section.

## server/src/app.ts

```ts
import { Hono } from "hono";
import { Health } from "@app/shared";

// The Hono app and every /api route, served by both entries. A plain Hono, which the Bun entry's
// serveClient(app: Hono) takes as it is.
export const app = new Hono();

app.get("/api/health", (c) =>
  c.json(Health.parse({ ok: true, time: new Date().toISOString() })),
);

// The app's other /api routes go here, as they were in index.ts.

// Last: an unknown /api path is a JSON 404, which the worker needs, since it never loads client.ts.
app.all("/api/*", (c) => c.json({ error: "not found" }, 404));
```

`app.ts` and the modules it imports never import `index.ts`, `client.ts`, `storage/files.ts` or `demo-account.ts`.

## wrangler.jsonc

Cloudflare's configuration file sits at the app's root as `wrangler.jsonc`:

```jsonc
{
  "name": "app",
  // The built worker module, which bun run build makes from server/src/worker.ts.
  "main": "server/dist/worker.js",
  "compatibility_date": "2026-11-01",
  "compatibility_flags": ["nodejs_compat"],
  "assets": {
    "directory": "client/dist",
    "not_found_handling": "single-page-application",
    "run_worker_first": ["/api/*"],
  },
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "app",
      "migrations_dir": "server/migrations",
    },
  ],
  "vars": { "NODE_ENV": "production" },
}
```

- `name` is the app's name in lowercase letters, digits and dashes.
- `main` points at the built module, never at TypeScript source.
- `compatibility_date` is today's date in UTC when you write the file (`date -u +%F` prints it), and stays fixed after that; it chooses which version of the runtime the app gets.
- `nodejs_compat` gives the worker Node's modules such as `node:buffer` and `node:crypto`, and fills `process.env` from `vars` and from the secrets set where the app is published.
- `assets` has Cloudflare serve the built client: a path that is no file gets `index.html`, and only `/api/*` reaches the worker.
- `d1_databases` holds one database, for an app that keeps data people enter; an app with none leaves the key out. The app gives the database's `binding`, the name the worker reads it by (`DB`, so `env.DB`), its `database_name`, and its `migrations_dir`. It never gives `database_id`: the publish creates the database, or finds the one it made before, binds it under that name and applies the migrations, and Cloudflare's tools run locally without an id.
- `vars` holds settings that are not secret. Secrets are set where the app is published, never here. The publish sets `NODE_ENV` to `production` itself, whatever `vars` says; the `NODE_ENV` entry here is for Cloudflare's own tools, which publish what the file says.

## What the publish reads

Publishing reads only these fields of `wrangler.jsonc`, so write each as this pack writes it and add no other. A publish refuses a file without the fields it needs, and the app does not run as built without the ones the pack writes for it. Every path is from the app's root in letters, digits, dots, dashes, underscores and slashes, at most 128 characters. Everything in `assets.directory` is served to anyone, so `main` and `migrations_dir` lie outside it, and source maps in it are never published:

| Field                            | Type                                                                         | The publish needs it                                                  | Example                        |
| -------------------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------ |
| `name`                           | lowercase letters, digits and dashes                                         | yes                                                                   | `"app"`                        |
| `main`                           | path from the app's root to the built worker module, made by `bun run build` | yes                                                                   | `"server/dist/worker.js"`      |
| `compatibility_date`             | `YYYY-MM-DD`, today's date in UTC                                            | yes                                                                   | `"2026-11-01"`                 |
| `compatibility_flags`            | list of flag names, holding `nodejs_compat`                                  | yes                                                                   | `["nodejs_compat"]`            |
| `assets.directory`               | path to the built client, made by `bun run build`                            | yes, with `assets`, which the starter's client needs                  | `"client/dist"`                |
| `assets.not_found_handling`      | `"single-page-application"`, `"404-page"` or `"none"`                        | no; the starter's client needs `"single-page-application"`            | `"single-page-application"`    |
| `assets.run_worker_first`        | list of route patterns the worker answers                                    | no; the starter's client needs `["/api/*"]`                           | `["/api/*"]`                   |
| `d1_databases`                   | list of one database, or left out                                            | for an app that keeps data                                            | as above                       |
| `d1_databases[0].binding`        | the name the worker reads it by                                              | yes, with a database                                                  | `"DB"`                         |
| `d1_databases[0].database_name`  | lowercase letters, digits and dashes                                         | no; `name` when left out                                              | `"app"`                        |
| `d1_databases[0].migrations_dir` | path from the app's root to the migrations                                   | no; `migrations` when left out, which is not where the pack puts them | `"server/migrations"`          |
| `vars`                           | text values by name, none of them secret                                     | no; the publish sets `NODE_ENV` to `production` itself                | `{ "NODE_ENV": "production" }` |

## The build

`bun run build` makes both the client and the worker. Give `server/package.json` a build script that bundles the worker entry for the Workers runtime:

```json
"build": "bun build src/worker.ts --target=browser --format=esm --external 'node:*' --external 'cloudflare:*' --define process.env.NODE_ENV='\"production\"' --sourcemap=linked --outdir dist"
```

- `--target=browser` and `--format=esm`: Workers runs ES modules in a browser-like runtime, not Bun.
- `--external 'node:*'` and `'cloudflare:*'`: the runtime provides those modules itself.
- `--define`: replaces `process.env.NODE_ENV` written with a dot, as libraries write it, with `"production"` in the built worker. It does not replace `process.env["NODE_ENV"]`, as `demo-account.ts` writes it; on Workers that reads the `NODE_ENV` the publish sets to `production`, which `nodejs_compat` puts in `process.env`.
- `--outdir dist` names the module `dist/worker.js` after `src/worker.ts`, and `--sourcemap=linked` writes `worker.js.map` beside it, which `check-serverless` follows back to the source. Use `--outdir`, not `--outfile`: with `--outfile` Bun writes the map next to the source and links none.

The root's `build` already runs every package's build, so it now makes `client/dist` and `server/dist/worker.js`. `server/dist` is build output, ignored by `.gitignore` like every `dist/`. Leave `start` and `dev` as they are: they run the Bun entry.

## The worker entry

```ts
// server/src/worker.ts
import { app } from "./app.ts";
import { useStorage } from "./store.ts";
import { d1Storage, type D1Database } from "./storage/d1.ts";

// What wrangler.jsonc binds: the D1 database and the variables.
type Env = { DB: D1Database; NODE_ENV: string };

// Cloudflare runs this for each request wrangler.jsonc's run_worker_first sends here (/api/*); it
// serves the built client itself.
export default {
  fetch(request: Request, env: Env) {
    useStorage(d1Storage(env.DB));
    return app.fetch(request, env);
  },
};
```

`Env` lives in `worker.ts`, the one file that reads bindings: it hands `env.DB` to the storage. `app.ts` stays `new Hono()` with no type parameter, so `serveClient(app: Hono)` in `client.ts` takes it and `client.ts` does not change; `app.ts` never imports `worker.ts`. A route reads a setting or secret from `process.env`, as it does on Bun, since on Workers `nodejs_compat` fills `process.env` from `vars` and the secrets. A route never reads `c.env`, which holds nothing under Bun.

## What the starter does that Workers cannot

| In the starter                                                                                                                                  | Why it fails on Workers                                                                                         | On Workers                                                                                          |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `server/src/store.ts` reads with `Bun.file` and writes with `node:fs/promises` (`mkdir`, `writeFile`, `rename`) under `server/data`             | There is no Bun, and `node:fs` is a memory-only file system: `/tmp` lasts one request and the rest is read-only | `createStore` over `useStorage`, with D1 behind it (`d1-store.md`)                                  |
| `store.ts` finds its folder from `import.meta.url`                                                                                              | No folder of the app's exists at run time                                                                       | The collection's name is its row in D1                                                              |
| `store.ts` runs updates one at a time through an in-process queue                                                                               | Many copies of the worker run at once, each with its own queue                                                  | Each update writes only if the version it read is still stored, and tries again                     |
| `server/src/client.ts` serves `client/dist` with `serveStatic` from `hono/bun`, located with `node:path`, `process.cwd()` and `import.meta.dir` | No Bun, no working directory, no files                                                                          | `assets` in `wrangler.jsonc`; only the Bun entry imports `client.ts`                                |
| `server/src/index.ts` is served by Bun on `PORT` through its default export                                                                     | Workers calls an exported `fetch`, with no port                                                                 | `server/src/worker.ts` above; `index.ts` stays the Bun entry                                        |
| `server/src/demo-account.ts` seeds an account with a password in the code, skipped when `NODE_ENV` is `production`                              | It must never exist where people use the app                                                                    | Only `index.ts` imports `demo-account.ts`, so the built worker never contains it (Checking it here) |
| `server/src/data/*.json` imported as modules                                                                                                    | Works: the bundle carries them                                                                                  | Keep importing them                                                                                 |

## Other things that do not work on Workers

- `Bun.password`, `Bun.hash`: hash passwords with PBKDF2 through `crypto.subtle.importKey` and `crypto.subtle.deriveBits` (SHA-256, a random 16-byte salt kept beside the hash, 100,000 iterations). Cloudflare's production runtime has refused PBKDF2 above 100,000 iterations, though a local run accepts more.
- `Bun.file`, `Bun.write`, `node:fs`, `bun:sqlite`, a database file of any kind: use D1.
- `Bun.serve`, `.listen()`, `@hono/node-server`, `hono/bun`: the exported `fetch` is the server.
- `node:child_process`: it can be imported, but does nothing.
- `setInterval`, a timer meant to outlive the request, or a job that runs in the background: nothing runs after the response except work handed to the request's `ctx.waitUntil`.
- `Bun.env`: read `process.env`, or `c.env` for bindings.

## Limits

- The free plan gives each request 10 ms of CPU time (time waiting on D1 or another service does not count), 128 MB of memory and 50 calls to other services. D1 takes at most 50 queries per request on the free plan, 100 bound parameters per query, and 2 MB per row.
- A publish without the person's own Cloudflare account goes to a temporary Cloudflare account, which allows one D1 database of up to 100 MB, at most 1,000 static files of 5 MiB each, and an address on `workers.dev` only. Keep the built client within that: no large images or videos in `client/public`, and no file over 5 MiB.

## Checking it here

The `check-serverless` line in `BUILDER-CHECKS.txt` names the module `main` in `wrangler.jsonc` names, so write it as `check-serverless server/dist/worker.js cloudflare:`, and change both together. `cloudflare:` says the `cloudflare:` modules are Workers' own. It follows `worker.js.map` to `server/src/worker.ts` and names every file in the worker that reaches the disk, uses Bun or listens on a port.

After `bun run build`, `grep -c demo-account server/dist/worker.js` prints `0`: the built worker holds no demo account, so a published app can never seed one, whatever `NODE_ENV` says. Any other count means something `worker.ts` imports reaches `demo-account.ts`; find that import and move it into `index.ts`. Cloudflare's own tools are not in this workspace and need nothing from you here: do not add `wrangler` to the app or sign in anywhere. Publishing builds, migrates and uploads the app.

## README

Add a section saying the app also runs on Cloudflare Workers: `wrangler.jsonc`, the D1 database it binds as `DB`, the migrations in `server/migrations`, the variables in `vars` and the secrets to set where it is published, and that `bun run build` makes `server/dist/worker.js`.

## References

- Configuration: https://developers.cloudflare.com/workers/wrangler/configuration/
- Single-page applications and `run_worker_first`: https://developers.cloudflare.com/workers/static-assets/routing/single-page-application/
- Node.js compatibility: https://developers.cloudflare.com/workers/runtime-apis/nodejs/
- `node:fs` on Workers: https://developers.cloudflare.com/workers/runtime-apis/nodejs/fs/
- `process.env` from `vars`: https://developers.cloudflare.com/workers/runtime-apis/nodejs/process/
- Web Crypto: https://developers.cloudflare.com/workers/runtime-apis/web-crypto/
- PBKDF2's iteration cap: https://github.com/cloudflare/workerd/issues/1346
- Workers limits: https://developers.cloudflare.com/workers/platform/limits/
- D1 limits: https://developers.cloudflare.com/d1/platform/limits/
- Temporary accounts and their limits: https://developers.cloudflare.com/workers/platform/claim-deployments/
- Hono on Workers: https://hono.dev/docs/getting-started/cloudflare-workers
