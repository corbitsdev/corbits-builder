import { and, inArray } from "drizzle-orm";
import {
  getDescendantTenants,
  workflowRunExecutability,
  type DB,
} from "@intx/db";
import { workflowRun as runTable } from "@intx/db/schema";
import {
  pushCredentialReconcile,
  type SidecarRouter,
  type RunCredentialsLoader,
} from "@intx/hub-sessions";
import type { CredentialCipher } from "@intx/types";
import type { MiddlewareHandler } from "hono";
import type { TenantEnv } from "@intx/hub-api";
import { getLogger } from "@intx/log";

const log = getLogger(["corbits-builder", "coordinator-credentials"]);

// After a credential's secret changes, pushes it to every active project run that uses it.
export function createCoordinatorCredentialRefresh(options: {
  db: DB["db"];
  router: SidecarRouter;
  cipher: CredentialCipher;
  loadRunCredentials: RunCredentialsLoader;
}): MiddlewareHandler<TenantEnv> {
  return async (c, next) => {
    await next();
    if (c.req.method !== "PATCH" || c.res.status !== 200) return;
    try {
      const body = await c.req.json();
      if (body.secret === undefined || body.status === "revoked") return;
      const credentialId = c.req.param("credentialId");
      const tenantId = c.req.param("tenantId");
      if (!credentialId || !tenantId) return;
      const tenants = await getDescendantTenants(options.db, tenantId);
      const runs = await options.db
        .select({ run: runTable })
        .from(runTable)
        .where(
          and(
            inArray(runTable.tenantId, tenants.length ? tenants : [tenantId]),
            inArray(runTable.status, ["deployed", "running"]),
          ),
        );
      await Promise.all(
        runs
          .filter(
            ({ run }) =>
              run.address &&
              workflowRunExecutability(run) === "executable" &&
              run.credentialRefs?.credentialIds.includes(credentialId),
          )
          .map(({ run }) =>
            pushCredentialReconcile(
              options.db,
              options.router,
              run.address!,
              options.cipher,
              options.loadRunCredentials,
            ),
          ),
      );
    } catch {
      // The credential is already stored; the sidecar picks it up when it reconnects.
      log.warn("Project workflow credential refresh unavailable");
    }
  };
}
