import { AsyncLocalStorage } from "node:async_hooks";
import { createMiddleware } from "hono/factory";
import { matchPattern } from "@intx/authz";
import type {
  GrantRule,
  GrantStore,
  ConditionRegistry,
} from "@intx/types/authz";
import { HUB_CONDITION_REGISTRY, type AppEnv } from "@intx/hub-api";

type BoundaryEnv = {
  Variables: AppEnv["Variables"] & { "git-token-claims"?: unknown };
};
const condition = "sb_git_token_resource";

// Caps a git token's grants to the resource it was issued for. Native auth sets the
// token's claims before its route asks this GrantStore, so the cap applies there and
// leaves authentication and repo validation to the native route.
export function createGitTokenBoundary(native: GrantStore) {
  const requests = new AsyncLocalStorage<() => unknown>();
  const scoped = (grants: GrantRule[]) => {
    const claims = requests.getStore()?.();
    if (claims === undefined) return grants;
    const resource =
      claims && typeof claims === "object" && "resource" in claims
        ? claims.resource
        : undefined;
    if (typeof resource !== "string" || !resource.trim()) return [];
    return grants.map((grant) =>
      grant.effect === "deny"
        ? grant
        : {
            ...grant,
            conditions: { ...grant.conditions, [condition]: resource },
          },
    );
  };
  const grantStore: GrantStore = {
    collectGrants: async (...args) =>
      scoped(await native.collectGrants(...args)),
    collectGrantsInChain: async (...args) =>
      scoped(await native.collectGrantsInChain(...args)),
  };
  const conditionRegistry: ConditionRegistry = {
    ...HUB_CONDITION_REGISTRY,
    [condition]: (resource, context) =>
      typeof resource === "string" && matchPattern(resource, context.resource),
  };
  return {
    middleware: createMiddleware<BoundaryEnv>((context, next) =>
      requests.run(() => context.get("git-token-claims"), next),
    ),
    grantStore,
    conditionRegistry,
  };
}
