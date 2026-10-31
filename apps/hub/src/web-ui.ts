import type { Env, Hono, MiddlewareHandler } from "hono";
import { serveStatic } from "hono/bun";

function outsideApi(handler: MiddlewareHandler): MiddlewareHandler {
  return (c, next) =>
    c.req.path.startsWith("/api/") ? next() : handler(c, next);
}

/** Serves the built UI from `root` same-origin with the API; unknown paths get its client-routed shell. */
export function mountWebUi<E extends Env>(app: Hono<E>, root: string): void {
  app.get("*", outsideApi(serveStatic({ root })));
  app.get("*", outsideApi(serveStatic({ root, path: "index.html" })));
}
