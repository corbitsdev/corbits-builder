import { and, eq } from "drizzle-orm";
import type { DB } from "@intx/db";
import { workflowRunExecutability } from "@intx/db";
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
import { projectCoordinator } from "../db/schema.ts";

const log = getLogger(["corbits-builder", "coordinator-credentials"]);

// After a credential's secret changes, pushes it to every active coordinator run that uses it.
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
      if (!credentialId) return;
      const bindings = await options.db
        .select({ run: runTable })
        .from(projectCoordinator)
        .innerJoin(runTable, eq(runTable.id, projectCoordinator.runId))
        .where(
          and(
            eq(projectCoordinator.active, true),
            eq(runTable.tenantId, c.req.param("tenantId")!),
          ),
        );
      await Promise.all(
        bindings
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
