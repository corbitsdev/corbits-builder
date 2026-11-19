# Data in D1

The starter's `createStore(name, schema, initial)` keeps each collection as a JSON file. On Workers the same collections live in D1, Cloudflare's SQLite database, one row per collection, and every route keeps calling `read` and `update` as before. Replace `server/src/store.ts` with the version below, though the starter's `AGENTS.md` says it stays as it is (the serverless pack overrides that), and add the two storage files; the Bun entry keeps the JSON files under `server/data`, so Live Preview and its data do not change.

## server/src/store.ts

```ts
import type { z } from "zod";

// Where collections are kept, which the entry chooses: JSON files on Bun, D1 on Workers.
export type Storage = {
  read(name: string): Promise<unknown>;
  update(
    name: string,
    change: (current: unknown) => Promise<unknown>,
  ): Promise<void>;
};

let storage: Storage | undefined;
export const useStorage = (chosen: Storage) => {
  storage = chosen;
};
const current = () => {
  if (!storage)
    throw new Error("no storage chosen: the entry calls useStorage");
  return storage;
};

// One collection, validated on every read and write; the rest of the app sees only read and update.
export function createStore<T>(name: string, schema: z.ZodType<T>, initial: T) {
  const read = async (): Promise<T> => {
    const stored = await current().read(name);
    return stored === undefined ? initial : schema.parse(stored);
  };
  return {
    read,
    update: async (change: (value: T) => T | Promise<T>): Promise<T> => {
      let next: T | undefined;
      await current().update(name, async (stored) => {
        next = schema.parse(
          await change(stored === undefined ? initial : schema.parse(stored)),
        );
        return next;
      });
      return next as T;
    },
  };
}
```

## server/src/storage/files.ts

The starter's file storage, unchanged in what it does, for the Bun entry. Only `index.ts` imports it.

```ts
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Storage } from "../store.ts";

// JSON files under server/data, one per collection, written atomically and one change at a time.
let queue = Promise.resolve();
const pathOf = (name: string) =>
  new URL(`../../data/${name}.json`, import.meta.url).pathname;
const read = async (name: string) => {
  const file = Bun.file(pathOf(name));
  return (await file.exists()) ? await file.json() : undefined;
};

export const fileStorage: Storage = {
  read,
  update: (name, change) => {
    const result = queue.then(async () => {
      const next = await change(await read(name));
      const path = pathOf(name);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path + ".tmp", JSON.stringify(next, null, 2));
      await rename(path + ".tmp", path);
    });
    queue = result.catch(() => undefined);
    return result;
  },
};
```

## server/src/storage/d1.ts

```ts
import type { Storage } from "../store.ts";

// The part of Cloudflare's D1 binding this module uses.
type Statement = {
  bind(...values: unknown[]): Statement;
  first<Row>(): Promise<Row | null>;
  run(): Promise<{ meta: { changes: number } }>;
};
export type D1Database = { prepare(sql: string): Statement };

const TRIES = 10;

// Each collection is one row of the collections table (server/migrations/0001_collections.sql), its JSON
// and a version. Several Worker instances serve at once, so an update writes only if the version it
// read is still the stored one, and reads and tries again when another request got there first.
export const d1Storage = (db: D1Database): Storage => {
  const row = (name: string) =>
    db
      .prepare("SELECT value, version FROM collections WHERE name = ?")
      .bind(name)
      .first<{ value: string; version: number }>();
  return {
    read: async (name) => {
      const found = await row(name);
      return found ? JSON.parse(found.value) : undefined;
    },
    update: async (name, change) => {
      for (let tried = 0; tried < TRIES; tried++) {
        const found = await row(name);
        const next = JSON.stringify(
          await change(found ? JSON.parse(found.value) : undefined),
        );
        const written = found
          ? await db
              .prepare(
                "UPDATE collections SET value = ?, version = version + 1 WHERE name = ? AND version = ?",
              )
              .bind(next, name, found.version)
              .run()
          : await db
              .prepare(
                "INSERT INTO collections (name, value, version) VALUES (?, ?, 1) ON CONFLICT (name) DO NOTHING",
              )
              .bind(name, next)
              .run();
        if (written.meta.changes === 1) return;
        // Requests that collided try again at different moments, waiting longer each time.
        await new Promise((done) =>
          setTimeout(done, Math.random() * 25 * (tried + 1)),
        );
      }
      throw new Error(`${name} changed under ${TRIES} tries in a row`);
    },
  };
};
```

The type above is the part of the binding this file uses, so the app needs no Cloudflare package. `first()` returns the row or `null`; `run()` returns `meta.changes`, the rows the statement changed, which is how an update knows whether it won.

## The entries

`server/src/index.ts`, its routes moved to `app.ts` (see `workers.md`), chooses the files and stays the Bun entry:

```ts
import { app } from "./app.ts";
import { serveClient } from "./client.ts";
import { useStorage } from "./store.ts";
import { fileStorage } from "./storage/files.ts";

// Development, Live Preview and `bun run start`: data in JSON files, the built client served here.
useStorage(fileStorage);
serveClient(app);

// Bun serves the default export on PORT.
export default app;
```

An app with sign-in seeds the demo account here, with the starter's `seedDemoAccount` line right after `useStorage(fileStorage)`, through the account store's own `createStore`, and nowhere else. `server/src/worker.ts` chooses D1 with each request (see `workers.md`).

## Migrations

D1's tables are made by SQL migrations in the folder `migrations_dir` names, `server/migrations`. Each is a numbered file applied once and in order, and D1 records the ones applied in its `d1_migrations` table:

```sql
-- server/migrations/0001_collections.sql
-- One row per collection the app keeps through createStore.
CREATE TABLE collections (
  name TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  version INTEGER NOT NULL
);
```

- Never edit or renumber a migration once the app has been published: add the next one, `0002_<what>.sql`.
- Name each file with only letters, digits, dashes, underscores and dots, ending in `.sql`, such as `0002_orders.sql`; publishing refuses any other name in the folder.
- The app never creates or alters tables while it runs; publishing applies the migrations before the new worker answers (Cloudflare's `wrangler d1 migrations apply <database> --remote`).
- What JSON a collection holds is the schema's business, not SQL's: changing a collection's shape needs no migration, but its schema must still read every row already stored, so add fields as optional or with a default.

## When one row is not enough

A collection is read and written whole, and D1 holds at most 2 MB in a row, so this suits settings, lists of a few thousand small records and anything that grows slowly. A collection that grows without limit, such as messages or orders, or that many people change at once, gets its own table in a migration and its own small module of queries beside `d1.ts`, keeping the same functions the routes already call. Bind values with `?` and `.bind()`, never by building SQL from strings.

## Concurrency

Many copies of the worker run at once, and an in-process queue in one does not stop another. Each `update` writes only if the version it read is still the stored one, and otherwise reads again and reapplies its change, waiting a moment longer each time. A change function may therefore run more than once: it computes the next value from the one it is given and does nothing else, such as sending an email; do that after `update` returns.
