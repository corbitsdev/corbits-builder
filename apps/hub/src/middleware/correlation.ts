import { AsyncLocalStorage } from "node:async_hooks";
import { createMiddleware } from "hono/factory";
import { withContext } from "@logtape/logtape";
import { getLogger } from "@intx/log";

export const requestContext = new AsyncLocalStorage<Record<string, unknown>>();
const log = getLogger(["corbits-builder", "hub"]);

export function correlationMiddleware() {
  return createMiddleware(async (c, next) => {
    const supplied = c.req.header("x-correlation-id");
    // Treat the ID as an opaque bounded token, never arbitrary log content.
    const correlationId =
      supplied && /^[A-Za-z0-9_-]{1,128}$/.test(supplied)
        ? supplied
        : crypto.randomUUID();
    c.header("x-correlation-id", correlationId);
    await requestContext.run({ correlationId }, () =>
      withContext({ correlationId }, async () => {
        await next();
        // Delegated handlers may return their own Response, replacing prepared
        // headers. Stamp the final response as well as Hono-generated errors.
        c.header("x-correlation-id", correlationId);
        log.info("HTTP {method} {route} {status}", {
          method: c.req.method,
          route: c.req.routePath,
          status: c.res.status,
        });
      }),
    );
  });
}
