import { expect, test } from "bun:test";
import { parseJsonc, readWorkersConfig } from "./config.ts";

// wrangler.jsonc as the workers-skills pack has the app builder write it.
const FITTED = `{
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
}`;

test("comments and trailing commas go, and what looks like them inside a string stays", () => {
  expect(
    parseJsonc(
      `{ "a": "x // y", /* z */ "b": ",}", "c": [1, /* , */ 2,], "d": "a /* b", "e": "q\\" // \\"", }`,
    ),
  ).toEqual({ a: "x // y", b: ",}", c: [1, 2], d: "a /* b", e: 'q" // "' });
  expect(parseJsonc("{ /* open")).toBeUndefined();
  expect(parseJsonc("not json")).toBeUndefined();
});

test("a worker module or its migrations inside the folder Cloudflare serves to anyone is refused", () => {
  expect(
    readWorkersConfig(FITTED.replace('"client/dist"', '"server/dist"')),
  ).toEqual({
    ok: false,
    problems: ["main lies inside assets.directory, which anyone can read"],
  });
  expect(
    readWorkersConfig(FITTED.replace('"client/dist"', '"server/migrations"')),
  ).toEqual({
    ok: false,
    problems: [
      "d1_databases[0].migrations_dir lies inside assets.directory, which anyone can read",
    ],
  });
});
