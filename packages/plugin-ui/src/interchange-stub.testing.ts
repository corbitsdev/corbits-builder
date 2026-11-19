/**
 * Interchange's provider and credential routes, and the hub's server key routes, as the credential
 * helpers and forms call them, for a workspace "ws" and its project "p1": every row kept in memory
 * and every request kept. For tests only.
 */

// The public half of the one key the stubbed server key routes hand out.
const ISSUED_KEY = "ssh-ed25519 AAAA builder-abcdefghijkl";

type Row = Record<string, unknown> & { id: string; tenantId: string };

const stamp = { createdAt: "2026-01-01", updatedAt: "2026-01-01" };

export function interchange() {
  const providers: Row[] = [];
  const credentials: Row[] = [];
  // How the server key routes answer: a read finds no key, an ask for a key is given ISSUED_KEY, and
  // a connect answers with the refusal when one is set and as connected otherwise.
  const serverKeys = {
    refusal: undefined as { status: number; code: string } | undefined,
  };
  const sent: { method: string; path: string; body?: unknown }[] = [];
  const chain = (tenant: string) => (tenant === "p1" ? ["p1", "ws"] : [tenant]);
  let next = 0;
  const json = (body: unknown, status = 200) => Response.json(body, { status });
  const serverKey = (method: string, step: string | undefined) => {
    if (method === "GET") return json({ code: "server_key_not_issued" }, 404);
    if (step === "key") return json({ publicKey: ISSUED_KEY, state: "issued" });
    if (serverKeys.refusal)
      return json({ code: serverKeys.refusal.code }, serverKeys.refusal.status);
    return json({
      publicKey: ISSUED_KEY,
      state: "bound",
      address: "203.0.113.5",
    });
  };
  const realFetch = globalThis.fetch;
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), "http://builder.test");
      const method = init?.method ?? "GET";
      const body =
        typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
      sent.push({ method, path: url.pathname + url.search, body });
      const [, , , tenant = "", kind = "", ...rest] = url.pathname.split("/");
      if (kind === "server-keys") return serverKey(method, rest[1]);
      const rows = kind === "providers" ? providers : credentials;
      const id = rest.join("/");
      if (method === "GET" && id === "" && kind === "providers")
        return json({
          data: providers.filter((row) =>
            url.searchParams.get("inherited") === "false"
              ? row.tenantId === tenant
              : chain(tenant).includes(row.tenantId),
          ),
          nextCursor: null,
        });
      if (method === "GET" && id.startsWith("resolve/")) {
        const name = decodeURIComponent(id.slice("resolve/".length));
        const held = chain(tenant)
          .map((owner) =>
            credentials.find(
              (row) => row.tenantId === owner && row.name === name,
            ),
          )
          .find((row) => row !== undefined);
        return held
          ? json(held)
          : json({ error: { code: "not_found", message: "" } }, 404);
      }
      const row = rows.find(
        (held) => held.id === id && chain(tenant).includes(held.tenantId),
      );
      if (method === "POST") {
        const created = {
          id: `${kind}-${++next}`,
          tenantId: tenant,
          ...(kind === "credentials" ? { status: "active" } : {}),
          ...body,
          ...stamp,
        };
        rows.push(created);
        return json(created, 201);
      }
      if (!row) return json({ error: { code: "not_found", message: "" } }, 404);
      if (method === "GET") return json(row);
      if (method === "PATCH") return json(Object.assign(row, body));
      rows.splice(rows.indexOf(row), 1);
      return new Response(null, { status: 204 });
    },
    { preconnect: realFetch.preconnect },
  );
  return {
    providers,
    credentials,
    sent,
    serverKeys,
    restore: () => {
      globalThis.fetch = realFetch;
    },
  };
}
