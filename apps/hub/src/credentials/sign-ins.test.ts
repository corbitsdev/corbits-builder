import { afterEach, expect, setSystemTime, test } from "bun:test";
import { createNoopCredentialCipher } from "@intx/crypto";
import { createPluginSignIns, signInCallback } from "./sign-ins.ts";

test("the callback address keeps the path a hub is served under", () => {
  expect(signInCallback(new URL("https://builder.example"))).toBe(
    "https://builder.example/api/oauth/callback",
  );
  expect(signInCallback(new URL("https://example.com/builder"))).toBe(
    "https://example.com/builder/api/oauth/callback",
  );
  expect(signInCallback(new URL("https://example.com/builder/"))).toBe(
    "https://example.com/builder/api/oauth/callback",
  );
});

afterEach(() => setSystemTime());

const person = { tenantId: "project-tenant", principalId: "person" };
const USER = "user";

// The sign-ins of a hub whose project tenant sits in a workspace and whose client at the provider
// is already registered, with every request it sends the provider kept.
function signIns() {
  const sent: string[] = [];
  // A query that answers rows whichever way it is narrowed.
  const query = (rows: readonly unknown[]) => {
    const narrowed: object = Object.assign(Promise.resolve(rows), {
      from: () => narrowed,
      innerJoin: () => narrowed,
      where: () => narrowed,
    });
    return narrowed;
  };
  const service = createPluginSignIns({
    db: {
      select: (fields: Record<string, unknown>) =>
        query(
          "workspace" in fields
            ? [{ workspace: "workspace" }]
            : [{ clientId: "registered" }],
        ),
    } as never,
    cipher: createNoopCredentialCipher(),
    credentials: [
      {
        name: "hoster",
        origin: "https://api.hoster.test",
        signIn: {
          authorize: "https://hoster.test/oauth/authorize",
          token: "https://hoster.test/oauth/token",
          scopes: ["deploy"],
          client: { register: "https://hoster.test/oauth/register" },
        },
      },
    ],
    publicURL: new URL("https://builder.test"),
    clientName: "Builder",
    pushRevoke: () => {},
    pushRenewed: () => {},
    fetch: Object.assign(
      async (input: Request | string | URL) => {
        sent.push(String(input instanceof Request ? input.url : input));
        return Response.json({}, { status: 500 });
      },
      { preconnect: fetch.preconnect },
    ),
  });
  const start = async () => {
    const started = await service.start(person, USER, "hoster");
    return {
      id: started.id,
      state: new URL(started.url).searchParams.get("state") ?? "",
    };
  };
  return { service, start, sent };
}

test("a second sign-in for the same credential replaces the first, whose callback exchanges nothing", async () => {
  const { service, start, sent } = signIns();
  const first = await start();
  const second = await start();
  expect(service.state(person, first.id)).toEqual({
    status: "failed",
    code: "sign_in_replaced",
  });
  expect(
    await service.callback({ state: first.state, code: "code" }, USER),
  ).toBe(false);
  expect(sent).toEqual([]);
  expect(service.state(person, second.id)).toEqual({ status: "pending" });
});

test("a sign-in left past its time expires, and its callback exchanges nothing", async () => {
  const { service, start, sent } = signIns();
  const now = Date.now();
  const started = await start();
  setSystemTime(new Date(now + 16 * 60 * 1000));
  expect(service.state(person, started.id)).toEqual({
    status: "failed",
    code: "sign_in_expired",
  });
  expect(
    await service.callback({ state: started.state, code: "code" }, USER),
  ).toBe(false);
  expect(sent).toEqual([]);
});
