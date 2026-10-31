import { expect, test } from "bun:test";
import { Hono } from "hono";
import { authorize } from "@intx/authz";
import type { GrantRule, GrantStore } from "@intx/types/authz";
import type { AppEnv } from "@intx/hub-api";
import { createGitTokenBoundary } from "./git-token-boundary.ts";

type Env = {
  Variables: AppEnv["Variables"] & { "git-token-claims"?: unknown };
};
const rule = (
  id: string,
  resource: string,
  effect: GrantRule["effect"],
): GrantRule => ({
  id,
  resource,
  action: "*",
  effect,
  origin: "role",
  conditions: null,
  expiresAt: null,
  roleId: "fixture-role",
  principalId: null,
});
function fixture(grants: GrantRule[]) {
  const native: GrantStore = {
    collectGrants: async () => {
      await Promise.resolve();
      return grants;
    },
    collectGrantsInChain: async () => grants,
  };
  const boundary = createGitTokenBoundary(native);
  const app = new Hono<Env>();
  app.use(boundary.middleware);
  // Only this unit fixture stands in for native middleware's trusted claims.
  // Real credential authentication/resource denial is covered by the API gate.
  app.use(async (c, next) => {
    const scope = c.req.query("scope");
    if (scope !== undefined) c.set("git-token-claims", JSON.parse(scope));
    await next();
  });
  app.get("/", async (c) => {
    const result = await authorize(
      boundary.grantStore,
      "principal",
      "tenant",
      c.req.query("resource")!,
      "read",
      { conditions: boundary.conditionRegistry },
    );
    return c.json({ effect: result.effect });
  });
  const check = async (resource: string, claims?: unknown) => {
    const query = new URLSearchParams({ resource });
    if (claims !== undefined) query.set("scope", JSON.stringify(claims));
    const result = (await (await app.request(`/?${query}`)).json()) as {
      effect: string | null;
    };
    return result.effect;
  };
  return { boundary, check };
}

test("native token scope intersects broad account grants per concurrent request without persisting changes", async () => {
  const grants = [rule("broad", "*", "allow")];
  const original = structuredClone(grants);
  const { boundary, check } = fixture(grants);
  const cases = Array.from({ length: 40 }, (_, i) => ({
    scope: `asset:${i % 2}`,
    target: `asset:${i % 3}`,
  }));
  const effects = await Promise.all(
    cases.map(({ scope, target }) => check(target, { resource: scope })),
  );
  expect(effects).toEqual(
    cases.map(({ scope, target }) => (scope === target ? "allow" : null)),
  );
  expect(await check("asset:other")).toBe("allow");
  expect(await check("agent-state:run", { resource: "asset:*" })).toBeNull();
  expect(await check("agent-state:run", { resource: "agent-state:run" })).toBe(
    "allow",
  );
  expect(await check("asset:any", { resource: "asset:*" })).toBe("allow");
  for (const claims of [
    null,
    {},
    { resource: 1 },
    { resource: "" },
    { resource: " " },
  ])
    expect(await check("asset:any", claims)).toBeNull();
  expect(grants).toEqual(original);
  expect(await boundary.grantStore.collectGrants("principal", "tenant")).toBe(
    grants,
  );
  expect(
    await boundary.grantStore.collectGrantsInChain("principal", "tenant"),
  ).toBe(grants);
});

test("resource ceiling preserves native ask/deny and existing conditions rather than adding authority", async () => {
  const allow = rule("allow", "asset:a", "allow");
  const hhmm = (offset: number) =>
    new Date(Date.now() + offset).toISOString().slice(11, 16);
  const window = {
    after: hhmm(3600000),
    before: hhmm(3660000),
    timezone: "UTC",
  };
  allow.conditions = { time_window: window };
  const { check } = fixture([
    rule("broad", "*", "allow"),
    rule("ask", "asset:a", "ask"),
    rule("deny", "asset:private", "deny"),
  ]);
  expect(await check("asset:a", { resource: "asset:a" })).toBe("ask");
  expect(await check("asset:private", { resource: "*" })).toBe("deny");
  expect(await check("asset:private", { resource: "asset:a" })).toBe("deny");
  expect(
    await fixture([]).check("asset:a", { resource: "asset:a" }),
  ).toBeNull();
  const conditioned = fixture([allow]);
  expect(
    await conditioned.check("asset:a", { resource: "asset:a" }),
  ).toBeNull();
  expect(allow.conditions).toEqual({ time_window: window });
});
