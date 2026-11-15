import { Hono } from "hono";
import { Health } from "@app/shared";
import { serveClient } from "./client.ts";

const app = new Hono();

app.get("/api/health", (c) =>
  c.json(Health.parse({ ok: true, time: new Date().toISOString() })),
);

// The built client, for `bun run start`, and the not-found answer for /api. Hono matches in order, so
// this comes after every /api route. In dev, Vite serves the client and proxies /api here.
serveClient(app);

// Bun serves the default export on PORT.
export default app;
