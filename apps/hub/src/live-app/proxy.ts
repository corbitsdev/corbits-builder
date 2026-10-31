import type { MiddlewareHandler } from "hono";
import { liveAppWording } from "../config/live-app.ts";

export type LiveAppScope = { tenantId: string; projectId: string };

type Exposed = LiveAppScope & {
  target: URL;
  server: Bun.Server<Upstream>;
  origin: string;
  lastUsed: number;
};
type Upstream = {
  url: string;
  protocols: string[];
  socket?: WebSocket;
  pending: (string | Bun.BufferSource)[];
};

const AUTHORIZED_MS = 30_000;
const HOP_BY_HOP = [
  "connection",
  "keep-alive",
  "transfer-encoding",
  "upgrade",
  "te",
  "trailer",
];

// Each project's app gets its own origin: a port on this host that forwards every path, method and
// WebSocket to the app in its sidecar. The app keeps its absolute paths and its
// own /api calls, and a frame of it can be same-origin with itself without reaching the hub's
// pages. Cookies ignore ports, so the browser sends the hub session along; each request is let
// through only when the hub would show that person the project, and the hub's cookies never
// reach the app.
export function createLiveAppProxy(options: {
  hostname: string;
  publicOrigin: URL;
  hubCookiePrefix: string;
  authorize: (request: Request, scope: LiveAppScope) => Promise<boolean>;
}) {
  const exposed = new Map<string, Exposed>();
  const authorized = new Map<string, number>();
  const hubCookie = (pair: string) =>
    pair.trim().startsWith(options.hubCookiePrefix);

  async function allows(request: Request, entry: Exposed) {
    const cookie = request.headers.get("cookie") ?? "";
    const key = [
      entry.projectId,
      request.headers.get("authorization") ?? "",
      ...cookie.split(";").filter(hubCookie),
    ].join("\n");
    if ((authorized.get(key) ?? 0) > Date.now()) return true;
    if (!(await options.authorize(request, entry))) return false;
    authorized.set(key, Date.now() + AUTHORIZED_MS);
    return true;
  }

  async function forward(request: Request, entry: Exposed) {
    const url = new URL(request.url);
    const headers = new Headers(request.headers);
    for (const name of ["host", ...HOP_BY_HOP]) headers.delete(name);
    const cookie = (request.headers.get("cookie") ?? "")
      .split(";")
      .filter((pair) => pair.trim() && !hubCookie(pair));
    if (cookie.length) headers.set("cookie", cookie.join(";"));
    else headers.delete("cookie");
    let response: Response;
    try {
      response = await fetch(new URL(url.pathname + url.search, entry.target), {
        method: request.method,
        headers,
        body: request.body,
        redirect: "manual",
        decompress: false,
      });
    } catch {
      return new Response(liveAppWording.unreachable, { status: 502 });
    }
    const out = new Headers(response.headers);
    for (const name of HOP_BY_HOP) out.delete(name);
    out.delete("set-cookie");
    for (const value of response.headers.getSetCookie())
      if (!hubCookie(value.split(";")[0] ?? ""))
        out.append("set-cookie", value);
    const location = out.get("location");
    if (location?.startsWith(entry.target.origin))
      out.set("location", location.slice(entry.target.origin.length) || "/");
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: out,
    });
  }

  function listen(scope: LiveAppScope, target: URL): Exposed {
    const entry = { ...scope, target, lastUsed: Date.now() } as Exposed;
    entry.server = Bun.serve<Upstream>({
      hostname: options.hostname,
      port: 0,
      fetch: async (request, server) => {
        if (!(await allows(request, entry)))
          return new Response(liveAppWording.signIn, { status: 401 });
        entry.lastUsed = Date.now();
        if (request.headers.get("upgrade")?.toLowerCase() !== "websocket")
          return forward(request, entry);
        const url = new URL(request.url);
        const socketUrl = new URL(url.pathname + url.search, entry.target);
        socketUrl.protocol = "ws:";
        const protocols = (request.headers.get("sec-websocket-protocol") ?? "")
          .split(",")
          .map((protocol) => protocol.trim())
          .filter(Boolean);
        const upgraded = server.upgrade(request, {
          data: { url: socketUrl.href, protocols, pending: [] },
          ...(protocols[0]
            ? { headers: { "sec-websocket-protocol": protocols[0] } }
            : {}),
        });
        return upgraded ? undefined : new Response(null, { status: 400 });
      },
      websocket: {
        open(client) {
          const socket = new WebSocket(client.data.url, client.data.protocols);
          socket.binaryType = "arraybuffer";
          socket.onopen = () => {
            for (const message of client.data.pending.splice(0))
              socket.send(message);
          };
          socket.onmessage = (event) => {
            entry.lastUsed = Date.now();
            client.send(event.data as string | ArrayBuffer);
          };
          socket.onclose = (event) =>
            client.close(event.code === 1005 ? 1000 : event.code);
          socket.onerror = () => client.close(1011);
          client.data.socket = socket;
        },
        message(client, message) {
          const socket = client.data.socket;
          if (socket?.readyState === WebSocket.OPEN) socket.send(message);
          else client.data.pending.push(message);
        },
        close(client) {
          client.data.socket?.close();
        },
      },
    });
    const origin = new URL(options.publicOrigin);
    origin.port = String(entry.server.port);
    entry.origin = origin.origin;
    return entry;
  }

  return {
    /** Serves the project's app, running at target, on its own origin and returns that origin. */
    expose(scope: LiveAppScope, target: string) {
      const current = exposed.get(scope.projectId);
      if (current) {
        current.target = new URL(target);
        return current.origin;
      }
      const entry = listen(scope, new URL(target));
      exposed.set(scope.projectId, entry);
      return entry.origin;
    },
    withdraw(projectId: string) {
      const entry = exposed.get(projectId);
      if (!entry) return;
      exposed.delete(projectId);
      void entry.server.stop(true);
    },
    /** When the person last loaded anything from the project's app, while it is exposed. */
    lastUsed: (projectId: string) => exposed.get(projectId)?.lastUsed,
    /**
     * The app's origin shares the hub's cookies, so a request it sends to the hub would carry the
     * person's session; the hub refuses any request an app origin makes.
     */
    refuseAppOrigins: (async (c, next) => {
      const port = URL.parse(c.req.header("origin") ?? "")?.port;
      if (
        port &&
        [...exposed.values()].some(
          (entry) => String(entry.server.port) === port,
        )
      )
        return c.json({ code: "app_origin_refused" }, 403);
      await next();
    }) satisfies MiddlewareHandler,
    close() {
      for (const projectId of exposed.keys()) this.withdraw(projectId);
    },
  };
}
