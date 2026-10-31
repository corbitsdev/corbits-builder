import fs from "node:fs";
import { type } from "arktype";
import git from "isomorphic-git";
import { Hono, type Context, type MiddlewareHandler } from "hono";
import { describeRoute, resolver } from "hono-openapi";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { mintGitToken, type AppEnv, type TenantEnv } from "@intx/hub-api";
import type { DB } from "@intx/db";
import {
  asset,
  gitToken,
  grant,
  liveWorkflowRunStatuses,
  principal,
  user,
  workflowRun,
  workflowRunLaunchSpec,
} from "@intx/db/schema";
import {
  APP_EXCLUDED_DIRECTORIES,
  AssetServiceError,
  DEFAULT_ASSET_REF,
  type AssetService,
  type RepoStore,
} from "@intx/hub-sessions";
import {
  MAX_APP_BYTES,
  type AppBundle,
} from "@corbits-builder/schemas/artifact";
import { outbox, project, projectCoordinator } from "../db/schema.ts";
import { spawnedWorkflowRole } from "../workflows/spawn-role.ts";
import {
  addBundleFile,
  AppTooLargeError,
  bundleContent,
  EXCLUDED_DIRECTORIES,
  excludedFile,
} from "../builds/app-snapshot.ts";

const TOKEN_LIFETIME_MS = 4 * 60 * 60 * 1000;
const GITIGNORE = [
  ...APP_EXCLUDED_DIRECTORIES.map((name) => `${name}/`),
  ".env*",
  "",
].join("\n");

const GRANTED_ACTIONS = ["read", "write"];

export const AppRepositoryAccess = type({
  path: "string",
  secret: "string",
  expiresAt: "string",
  author: { name: "string", email: "string" },
  runId: "string",
});
export type AppRepositoryAccess = typeof AppRepositoryAccess.infer;

const grantId = (principalId: string, resource: string, action: string) =>
  "sb-app-grant-" +
  new Bun.CryptoHasher("sha256")
    .update(principalId + "\n" + resource + "\n" + action)
    .digest("hex")
    .slice(0, 40);

class AppRepositoryError extends Error {
  constructor(
    readonly status: 403 | 409,
    readonly code: string,
  ) {
    super(code);
  }
}

export const appAssetName = (projectId: string) => `app-${projectId}`;

const findAppAsset = (db: DB["db"], tenantId: string, projectId: string) =>
  db.query.asset.findFirst({
    where: and(
      eq(asset.tenantId, tenantId),
      eq(asset.kind, "app"),
      eq(asset.name, appAssetName(projectId)),
    ),
  });

/** The id of the project's app asset, created with its repository on first use. */
export async function ensureAppAsset(
  db: DB["db"],
  assets: AssetService,
  tenantId: string,
  projectId: string,
  creatorPrincipalId: string,
) {
  const name = appAssetName(projectId);
  const find = () => findAppAsset(db, tenantId, projectId);
  const existing = await find();
  if (existing) return existing.id;
  try {
    return (
      await assets.createAsset({
        tenantId,
        kind: "app",
        name,
        creatorPrincipalId,
        initOpts: { gitignore: GITIGNORE },
      })
    ).id;
  } catch (error) {
    if (!(error instanceof AssetServiceError)) throw error;
    // Project ids may hold capitals or underscores, which asset names refuse.
    if (error.reason === "invalid_name")
      throw new AppRepositoryError(409, "project_id_not_asset_name");
    if (error.reason !== "duplicate_asset") throw error;
    const raced = await find();
    if (!raced) throw error;
    return raced.id;
  }
}

// The actor of the project's project.created event.
async function projectCreator(db: DB["db"], projectId: string) {
  const [creator] = await db
    .select({ id: user.id })
    .from(outbox)
    .innerJoin(
      principal,
      eq(principal.id, sql`${outbox.payload}->>'actorPrincipalId'`),
    )
    .innerJoin(
      user,
      and(eq(principal.kind, "user"), eq(user.id, principal.refId)),
    )
    .where(
      and(
        eq(outbox.projectId, projectId),
        eq(outbox.eventType, "project.created"),
      ),
    )
    .limit(1);
  if (!creator) throw new AppRepositoryError(409, "project_creator_unknown");
  return creator.id;
}

/**
 * Push access to the project's app repository for one run principal: the repository is created if
 * missing, the principal is granted read and write on it, and a service token bound to that
 * principal, the repository and refs/heads/main is minted. The path is on the hub API's origin.
 */
export async function issueAppPushAccess(
  db: DB["db"],
  assets: AssetService,
  args: {
    tenantId: string;
    domain: string;
    projectId: string;
    runPrincipalId: string;
    runId: string;
  },
): Promise<AppRepositoryAccess> {
  const assetId = await ensureAppAsset(
    db,
    assets,
    args.tenantId,
    args.projectId,
    args.runPrincipalId,
  );
  const resource = `asset:${assetId}`;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + TOKEN_LIFETIME_MS);
  await db
    .insert(grant)
    .values(
      GRANTED_ACTIONS.map((action) => ({
        id: grantId(args.runPrincipalId, resource, action),
        tenantId: args.tenantId,
        principalId: args.runPrincipalId,
        resource,
        action,
        effect: "allow" as const,
        origin: "system" as const,
        expiresAt,
      })),
    )
    .onConflictDoUpdate({
      target: grant.id,
      set: { expiresAt, updatedAt: now },
    });
  const minted = await mintGitToken(db, {
    kind: "svc",
    // A git token row must name a user, and native approvals record no resolver.
    userId: await projectCreator(db, args.projectId),
    principalId: args.runPrincipalId,
    tenantId: args.tenantId,
    name: `builder-${args.runId}-${crypto.randomUUID()}`,
    resource,
    refPattern: "refs/heads/main",
    rawActions: ["can_read", "can_push"],
    expiresAt,
    now,
  });
  return {
    path: `/api/tenants/${encodeURIComponent(args.tenantId)}/assets/app/${appAssetName(args.projectId)}.git`,
    secret: minted.secret,
    expiresAt: minted.expiresAt.toISOString(),
    author: { name: "Builder", email: `builder@${args.domain}` },
    runId: args.runId,
  };
}

/** Ends a run principal's app push access: its tokens are revoked and its grants removed. */
export async function revokeAppPushAccess(
  db: DB["db"],
  args: { tenantId: string; projectId: string; runPrincipalId: string },
) {
  const app = await findAppAsset(db, args.tenantId, args.projectId);
  if (!app) return;
  const resource = `asset:${app.id}`;
  await db
    .update(gitToken)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(gitToken.principalId, args.runPrincipalId),
        eq(gitToken.resource, resource),
        isNull(gitToken.revokedAt),
      ),
    );
  await db.delete(grant).where(
    inArray(
      grant.id,
      GRANTED_ACTIONS.map((action) =>
        grantId(args.runPrincipalId, resource, action),
      ),
    ),
  );
}

/**
 * The tip of an app repository's main: its commit, when it was committed, and its files read from
 * the commit's tree, never the working tree. The files are what a snapshot files: the excluded
 * directories and files are left out, as are links and submodules, and they are held to the app
 * limit. They are undefined while main holds no app, as at the repository's genesis.
 */
export async function appRepositoryMain(dir: string) {
  const commit = await git.resolveRef({ fs, dir, ref: DEFAULT_ASSET_REF });
  const { tree, committer } = (await git.readCommit({ fs, dir, oid: commit }))
    .commit;
  const read = async () => {
    const collected: Required<AppBundle> = { files: {}, binary: {} };
    let bytes = 0;
    const walk = async (oid: string, prefix: string) => {
      for (const entry of (await git.readTree({ fs, dir, oid })).tree) {
        if (entry.type === "tree") {
          if (!EXCLUDED_DIRECTORIES.has(entry.path))
            await walk(entry.oid, prefix + entry.path + "/");
        } else if (
          entry.type === "blob" &&
          entry.mode !== "120000" &&
          !excludedFile(entry.path)
        ) {
          const { blob } = await git.readBlob({ fs, dir, oid: entry.oid });
          bytes += blob.length;
          // Content outgrows its raw bytes, so this stops the read before it outgrows the limit.
          if (bytes > MAX_APP_BYTES) throw new AppTooLargeError(bytes);
          addBundleFile(collected, prefix + entry.path, blob);
        }
      }
    };
    await walk(tree, "");
    return "package.json" in collected.files
      ? bundleContent(collected)
      : undefined;
  };
  return {
    commit,
    committedAt: new Date(committer.timestamp * 1000),
    read,
  };
}

/** The tip of the project's app repository's main, or undefined while the project has none. */
export async function readAppRepository(
  db: DB["db"],
  repoStore: RepoStore,
  tenantId: string,
  projectId: string,
) {
  const app = await findAppAsset(db, tenantId, projectId);
  return app
    ? appRepositoryMain(repoStore.getRepoDir({ kind: "app", id: app.id }))
    : undefined;
}

// Only a live coder run of the project reaches these routes; its run token is authenticated by the
// agent-token bridge, which sets the run's workflow principal and the project's tenant.
export function createAppRepositoryRoutes(
  db: DB["db"],
  assets: AssetService,
  authenticate: MiddlewareHandler<AppEnv>,
) {
  const coordinatorRun = alias(workflowRun, "coordinator_run");

  // The caller is a live coder run that this project's coordinator deployed.
  const coderRun = async (c: Context<TenantEnv>) => {
    const caller = c.get("principal");
    const tenant = c.get("tenant");
    if (caller?.kind !== "workflow" || !tenant)
      throw new AppRepositoryError(403, "forbidden");
    const projectId = c.req.param("projectId")!;
    const [run] = await db
      .select({ bundle: workflowRunLaunchSpec.frozenApprovalBundle })
      .from(workflowRun)
      .innerJoin(
        workflowRunLaunchSpec,
        eq(workflowRunLaunchSpec.anchorRunId, workflowRun.id),
      )
      .innerJoin(
        coordinatorRun,
        eq(
          coordinatorRun.principalId,
          workflowRunLaunchSpec.sourceAuthorityPrincipalId,
        ),
      )
      .innerJoin(
        projectCoordinator,
        eq(projectCoordinator.runId, coordinatorRun.id),
      )
      .innerJoin(project, eq(project.id, projectCoordinator.projectId))
      .where(
        and(
          eq(workflowRun.id, caller.refId),
          eq(workflowRun.tenantId, tenant.id),
          inArray(workflowRun.status, [...liveWorkflowRunStatuses]),
          eq(project.id, projectId),
          eq(project.tenantId, tenant.id),
        ),
      )
      .limit(1);
    if (spawnedWorkflowRole(run?.bundle) !== "coder")
      throw new AppRepositoryError(403, "forbidden");
    return {
      tenantId: tenant.id,
      domain: tenant.domain,
      projectId,
      runPrincipalId: caller.id,
      runId: caller.refId,
    };
  };

  const app = new Hono<TenantEnv>();
  app.use("*", authenticate);
  app.post(
    "/:projectId/app-repository",
    describeRoute({
      tags: ["Projects"],
      operationId: "issueAppPushAccess",
      description:
        "Push access to the project's app repository for the calling coder run. Callable only with a live coder run's token.",
      security: [{ coordinatorBearer: [] }],
      responses: {
        200: {
          description:
            "Repository path on the hub API origin, a short-lived push token, and the commit author",
          content: {
            "application/json": { schema: resolver(AppRepositoryAccess) },
          },
        },
      },
    }),
    async (c) => {
      try {
        const run = await coderRun(c);
        return c.json(await issueAppPushAccess(db, assets, run));
      } catch (error) {
        if (error instanceof AppRepositoryError)
          return c.json({ code: error.code }, error.status);
        throw error;
      }
    },
  );
  app.post(
    "/:projectId/app-repository/revoke",
    describeRoute({
      tags: ["Projects"],
      operationId: "revokeAppPushAccess",
      description:
        "Revokes the calling coder run's push tokens for the project's app repository and removes its grants on it.",
      security: [{ coordinatorBearer: [] }],
      responses: { 200: { description: "Access revoked" } },
    }),
    async (c) => {
      try {
        await revokeAppPushAccess(db, await coderRun(c));
        return c.json({ ok: true });
      } catch (error) {
        if (error instanceof AppRepositoryError)
          return c.json({ code: error.code }, error.status);
        throw error;
      }
    },
  );
  return app;
}
