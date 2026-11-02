import {
  InstalledWorkflows,
  INSTALLED_WORKFLOWS_KEY,
  type WorkflowRole,
} from "@corbits-builder/schemas/installed-workflows";
import { projectCoordinator } from "../db/schema.ts";
import { verifyAgentToken } from "@corbits/agent-token";
import { sha256 } from "@intx/crypto";
import { createGrantStore, type createDB } from "@intx/db";
import {
  principal,
  tenant,
  workflowRun,
  workflowRunLaunchSpec,
  grant,
} from "@intx/db/schema";
import {
  createRequireGrant,
  HUB_CONDITION_REGISTRY,
  requireAuth,
  type TenantEnv,
  type AppEnv,
} from "@intx/hub-api";
import { and, eq } from "drizzle-orm";
import type { MiddlewareHandler } from "hono";
import { getLogger } from "@intx/log";
import { createCoordinatorRegistry } from "./coordinator-registry.ts";
import { projectResource } from "../projects/errors.ts";
import { spawnedWorkflowRole } from "../workflows/spawn-role.ts";
import { buildPackageLayout } from "../builds/package-layout.ts";
import { installsAnyPackage, opensNetwork } from "../config/preferences.ts";
import { loadSettings } from "../settings/policy.ts";

let layoutPromise: ReturnType<typeof buildPackageLayout> | undefined;
const buildLayout = () =>
  (layoutPromise ??= buildPackageLayout().catch((error: unknown) => {
    layoutPromise = undefined;
    throw error;
  }));

const log = getLogger(["corbits-builder", "agent-callback-auth"]);

// A packaged specialist declares invoker requirements, and the coordinator that
// deploys it is itself an invoker. The specialist gets copies of the coordinator's
// delegatable deployer grants, so it resolves against that same authority; mail
// admission stays with the coordinator.
async function mirrorDelegatableDeployerGrants(
  db: ReturnType<typeof createDB>["db"],
  args: { tenantId: string; runId: string; principalId: string },
) {
  const [run] = await db
    .select({
      anchorRunId: workflowRun.anchorRunId,
      principalId: workflowRun.principalId,
    })
    .from(workflowRun)
    .where(
      and(
        eq(workflowRun.id, args.runId),
        eq(workflowRun.tenantId, args.tenantId),
      ),
    )
    .limit(1);
  if (!run) return;
  const [parent] = await db
    .select({ source: workflowRunLaunchSpec.sourceAuthorityPrincipalId })
    .from(workflowRunLaunchSpec)
    .where(eq(workflowRunLaunchSpec.anchorRunId, run.anchorRunId ?? args.runId))
    .limit(1);
  if (!parent) return;
  if (parent.source === (run.principalId ?? args.principalId)) return;
  const held = await createGrantStore(db).collectGrants(
    parent.source,
    args.tenantId,
  );
  const rows = held.flatMap((item) => {
    if (item.origin === "invoker" && item.effect === "allow") return [];
    const id =
      "mirror-" +
      new Bun.CryptoHasher("sha256")
        .update(args.principalId + "\n" + item.id)
        .digest("hex")
        .slice(0, 48);
    return [
      {
        id,
        tenantId: args.tenantId,
        principalId: args.principalId,
        resource: item.resource,
        action: item.action,
        effect: item.effect,
        conditions: item.conditions,
        origin: "system" as const,
        expiresAt: item.expiresAt,
      },
    ];
  });
  if (rows.length === 0) return;
  await db.insert(grant).values(rows).onConflictDoNothing();
}

const NATIVE_RUN_TOKEN_PREFIX = "itx_run_";

// Native run-token auth owns this route and sets the deployer; the copy above runs first so grant
// materialization can start the specialist run.
function isNativeWorkflowDeploy(method: string, path: string): boolean {
  return (
    method === "POST" &&
    /^\/api\/tenants\/[^/]+\/workflows\/deployments$/.test(path)
  );
}

type RunTokenLookup = {
  findByHash(
    tokenHash: Uint8Array,
  ): Promise<{ principalId: string } | undefined>;
};

type PresentedRun = {
  id: string;
  tenantId: string;
  definitionId: string;
  runId: string;
};

// Product routes admit the itx_run_ token Interchange delivers on
// interchange.hub; this resolves that token to its run.
async function nativeRunIdentity(
  db: ReturnType<typeof createDB>["db"],
  runTokens: RunTokenLookup,
  bearer: string,
): Promise<PresentedRun | null> {
  const row = await runTokens.findByHash(await sha256(bearer));
  if (!row) return null;
  const [actor] = await db
    .select()
    .from(principal)
    .where(eq(principal.id, row.principalId))
    .limit(1);
  if (
    !actor ||
    actor.kind !== "workflow" ||
    actor.status !== "active" ||
    !actor.refId
  )
    return null;
  const [run] = await db
    .select({
      id: workflowRun.id,
      tenantId: workflowRun.tenantId,
      definitionId: workflowRun.definitionId,
      principalId: workflowRun.principalId,
    })
    .from(workflowRun)
    .where(eq(workflowRun.id, actor.refId))
    .limit(1);
  if (!run || run.tenantId !== actor.tenantId || run.principalId !== actor.id)
    return null;
  return {
    id: row.principalId,
    tenantId: actor.tenantId,
    definitionId: run.definitionId,
    runId: run.id,
  };
}

export function createAgentTokenBridge(
  db: ReturnType<typeof createDB>["db"],
  runTokens?: RunTokenLookup,
) {
  const registry = createCoordinatorRegistry(db);
  const authenticated = new WeakSet<Request>();
  const requireGrant = createRequireGrant({
    grantStore: createGrantStore(db),
    conditionRegistry: HUB_CONDITION_REGISTRY,
  });
  const resolve = async (runId: string) => {
    const binding = await registry.boundRun(runId);
    if (!binding || !binding.run.principalId) return null;
    const [actor] = await db
      .select()
      .from(principal)
      .where(
        and(
          eq(principal.id, binding.run.principalId),
          eq(principal.kind, "workflow"),
          eq(principal.refId, runId),
          eq(principal.tenantId, binding.run.tenantId),
          eq(principal.status, "active"),
        ),
      );
    return actor ? { binding, actor } : null;
  };
  const middleware: MiddlewareHandler<TenantEnv> = async (c, next) => {
    authenticated.delete(c.req.raw);
    const recordRefusal = (
      reason:
        | "bearer_missing"
        | "mixed_credentials"
        | "token_unverified"
        | "token_run_missing"
        | "token_tenant_mismatch",
    ) => {
      log.debug("Run token auth refused: {reason}", { reason });
    };
    const authorization = c.req.header("authorization");
    const bearer = authorization?.match(/^Bearer ([^\s]+)$/i)?.[1];
    if (!bearer) {
      recordRefusal("bearer_missing");
      return next();
    }
    if (c.req.header("cookie")) {
      recordRefusal("mixed_credentials");
      return c.json({ error: "unauthorized" }, 401);
    }
    const nativeBearer = bearer.startsWith(NATIVE_RUN_TOKEN_PREFIX);
    const artifactRoute =
      /^\/api\/tenants\/[^/]+\/projects\/[^/]+\/(?:artifacts(?:\/[^/]+)?|artifact-approvals|design-themes\/run|design-draft\/previous|app-repository(?:\/revoke)?)$/.test(
        c.req.path,
      );
    const runtimeScope = c.req.path === "/api/workflow-project-scope";
    const nativeProject = /^\/api\/tenants\/[^/]+\/projects\//.test(c.req.path);
    const identity = nativeBearer
      ? (artifactRoute || nativeProject || runtimeScope) && runTokens
        ? await nativeRunIdentity(db, runTokens, bearer)
        : null
      : await verifyAgentToken(db, bearer);
    if (!identity) {
      if (nativeBearer && isNativeWorkflowDeploy(c.req.method, c.req.path)) {
        const deployer =
          runTokens === undefined
            ? null
            : await nativeRunIdentity(db, runTokens, bearer);
        if (deployer?.runId && deployer.tenantId === c.req.param("tenantId"))
          await mirrorDelegatableDeployerGrants(db, {
            tenantId: deployer.tenantId,
            runId: deployer.runId,
            principalId: deployer.id,
          });
      }
      if (!nativeBearer) recordRefusal("token_unverified");
      return next();
    }
    if (nativeBearer) c.req.raw.headers.delete("authorization");
    const denied = () => c.json({ error: "unauthorized" }, 401);
    if (!identity.runId || c.req.header("cookie")) {
      recordRefusal("token_run_missing");
      return denied();
    }
    if (runtimeScope) {
      if (!nativeBearer || c.req.method !== "GET") return denied();
      let binding = await registry.boundRun(identity.runId);
      let role: WorkflowRole = "coordinator";
      if (!binding) {
        const launch = await db.query.workflowRunLaunchSpec.findFirst({
          where: eq(workflowRunLaunchSpec.anchorRunId, identity.runId),
        });
        const spawned = spawnedWorkflowRole(launch?.frozenApprovalBundle);
        if (!launch || !spawned) return denied();
        role = spawned;
        const [invoker] = await db
          .select({ runId: projectCoordinator.runId })
          .from(projectCoordinator)
          .innerJoin(workflowRun, eq(workflowRun.id, projectCoordinator.runId))
          .where(
            and(
              eq(projectCoordinator.active, true),
              eq(workflowRun.tenantId, identity.tenantId),
              eq(workflowRun.principalId, launch.sourceAuthorityPrincipalId),
            ),
          );
        if (!invoker) return denied();
        binding = await registry.boundRun(invoker.runId);
      }
      if (!binding || binding.run.tenantId !== identity.tenantId)
        return denied();
      const row = await db.query.tenant.findFirst({
        where: eq(tenant.id, identity.tenantId),
      });
      if (!row) return denied();
      const config = row.config as Record<string, unknown> | null;
      const installed = InstalledWorkflows.assert(
        config?.[INSTALLED_WORKFLOWS_KEY],
      );
      const { preferences } = await loadSettings(
        db,
        identity.tenantId,
        binding.projectId,
      );
      return c.json({
        tenantId: row.id,
        domain: row.domain,
        projectId: binding.projectId,
        role,
        workflows: {
          writer: installed.writer,
          reviewer: installed.reviewer,
          coder: installsAnyPackage(preferences.value)
            ? installed.coderAnyPackage
            : installed.coder,
          designer: installed.designer,
          ...(installed.presenter ? { presenter: installed.presenter } : {}),
        },
        openNetwork: opensNetwork(preferences.value),
        build: await buildLayout(),
      });
    }
    if (identity.tenantId !== c.req.param("tenantId")) {
      recordRefusal("token_tenant_mismatch");
      return denied();
    }
    const base = "/api/tenants/" + encodeURIComponent(identity.tenantId);
    // Spawned specialists hold no project binding; their native grants decide
    // which artifacts they may read and write.
    if (artifactRoute && !(await registry.boundRun(identity.runId))) {
      const collection =
        /\/(?:artifacts|artifact-approvals|app-repository(?:\/revoke)?)$/.test(
          c.req.path,
        );
      if (
        !nativeBearer ||
        (c.req.method !== "GET" && !(collection && c.req.method === "POST"))
      )
        return denied();
      const [actor] = await db
        .select()
        .from(principal)
        .where(
          and(
            eq(principal.id, identity.id),
            eq(principal.kind, "workflow"),
            eq(principal.status, "active"),
          ),
        );
      const tenantRow = await db.query.tenant.findFirst({
        where: eq(tenant.id, identity.tenantId),
      });
      if (!actor || !tenantRow) return denied();
      c.set("principal", actor);
      c.set("tenant", tenantRow);
      authenticated.add(c.req.raw);
      return next();
    }
    const binding = await registry.boundRun(identity.runId);
    if (
      !binding ||
      identity.tenantId !== c.req.param("tenantId") ||
      identity.tenantId !== binding.run.tenantId ||
      identity.definitionId !== binding.run.definitionId
    )
      return denied();
    const projectBase =
      base + "/projects/" + encodeURIComponent(binding.projectId);
    const suffix = c.req.path.startsWith(projectBase)
      ? c.req.path.slice(projectBase.length)
      : null;
    const projectRoute =
      suffix !== null &&
      ((c.req.method === "GET" &&
        /^(|\/audit|\/artifacts(?:\/[^/]+)?)$/.test(suffix)) ||
        (c.req.method === "POST" &&
          /^(\/mutations|\/artifacts|\/artifact-approvals|\/design-concepts)$/.test(
            suffix,
          )));
    const deployRoute =
      c.req.method === "POST" && c.req.path === base + "/workflows/deployments";
    if (!projectRoute && !deployRoute) return denied();
    const tenantRow = await db.query.tenant.findFirst({
      where: eq(tenant.id, identity.tenantId),
    });
    if (!tenantRow) return denied();
    c.set("tenant", tenantRow);
    const resolved = await resolve(identity.runId);
    if (!resolved || resolved.binding.projectId !== binding.projectId)
      return denied();
    c.set("principal", resolved.actor);
    return requireGrant(projectResource(binding.projectId), "manage")(
      c,
      async () => {
        if (deployRoute)
          await mirrorDelegatableDeployerGrants(db, {
            tenantId: identity.tenantId,
            runId: identity.runId!,
            principalId: resolved.actor.id,
          });
        authenticated.add(c.req.raw);
        await next();
      },
    );
  };
  const authenticateProject: MiddlewareHandler<AppEnv> = async (c, next) =>
    authenticated.has(c.req.raw) ? next() : requireAuth(c, next);
  return { middleware, authenticateProject, registry };
}
