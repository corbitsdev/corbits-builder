import { join, relative } from "node:path";
import type { Hono } from "hono";
import { serveStatic } from "hono/bun";

// serveStatic resolves paths against the working directory, so the built client is located from
// this file and the server finds it wherever it is started.
const root = relative(
  process.cwd(),
  join(import.meta.dir, "../../client/dist"),
);

/** Answers an unknown /api path with a JSON 404 and serves the built client, every other path by index.html. */
export function serveClient(app: Hono) {
  app.all("/api/*", (c) => c.json({ error: "not found" }, 404));
  app.use("*", serveStatic({ root }));
  app.get("*", serveStatic({ path: join(root, "index.html") }));
}
