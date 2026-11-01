import { type } from "arktype";
import { and, eq, inArray, sql } from "drizzle-orm";
import { ARTIFACTS_SCHEMA } from "@corbits/artifacts";
import type { DB, DBExecutor } from "@intx/db";
import {
  principal,
  tenant,
  workflowRun,
  workflowRunLaunchSpec,
} from "@intx/db/schema";
import { canonicalJsonStringify } from "@intx/types/wire-definition-hash";
import {
  ProjectId,
  ProjectLifecycleReceipt,
  ProjectLifecycleStatus,
  ProjectMutation,
  ProjectMutationReceipt,
  ProjectShipReceipt,
  ProjectSummaryList,
  ProjectView,
} from "@corbits-builder/schemas/project";
import {
  project,
  projectCoordinator,
  mutationReceipt,
  outbox,
  settingsRecord,
} from "../db/schema.ts";
import {
  defaultSettings,
  loadSettings,
  loadSettingsAt,
  personalScopeKey,
} from "../settings/policy.ts";
import { resolvePreferences } from "../config/preferences.ts";
import { frozenModelChoice, pickedModelChoice } from "../config/models.ts";
import { parseStatusFilter } from "./lifecycle.ts";
import {
  grantAuthorization,
  userPrincipalIn,
  type Allowed,
} from "./authorization.ts";
import { workflowRoleSql } from "../workflows/spawn-role.ts";

export { ProjectError, projectResource } from "./errors.ts";
import { ProjectError, projectResource, typeIssues } from "./errors.ts";
import { digest } from "../lib/digest.ts";
import type { Actor } from "../lib/actor.ts";

/** Creates a native child tenant as the calling user; the route owns how it reaches Interchange. */
export type CreateTenant = (body: {
  name: string;
  slug: string;
  parentId: string;
}) => Promise<{ id: string }>;

/** A caller of project mutations: its principal where it addresses the project, and its user. */
export type ProjectCaller = Actor & {
  userId: string | undefined;
  parentTenantId: string | null;
};

const SLUG_WORDS = [
  [
    "amber",
    "brisk",
    "calm",
    "deft",
    "eager",
    "fair",
    "glad",
    "keen",
    "lucid",
    "merry",
    "noble",
    "quiet",
    "rapid",
    "sunny",
    "tidy",
    "vivid",
    "witty",
    "zesty",
  ],
  [
    "acorn",
    "brook",
    "cedar",
    "dune",
    "ember",
    "fern",
    "grove",
    "harbor",
    "island",
    "juniper",
    "lagoon",
    "meadow",
    "orchard",
    "prairie",
    "ridge",
    "summit",
    "tundra",
    "willow",
  ],
  [
    "badger",
    "crane",
    "dolphin",
    "falcon",
    "gecko",
    "heron",
    "ibis",
    "koala",
    "lynx",
    "marten",
    "otter",
    "panda",
    "quail",
    "raven",
    "stork",
    "tapir",
    "walrus",
    "yak",
  ],
] as const;
const SLUG_ATTEMPTS = 3;

function threeWordSlug(): string {
  const picks = crypto.getRandomValues(new Uint32Array(SLUG_WORDS.length));
  return SLUG_WORDS.map(
    (words, index) => words[picks[index]! % words.length],
  ).join("-");
}

export function createProjectService(db: DB["db"]) {
  // Collect before opening the transaction: asking the same pool for an outer
  // grant query while every connection holds a transaction can deadlock.
  const authorizationFor = (actor: Actor) => grantAuthorization(db, actor);
  async function requireActor(
    tx: DBExecutor,
    actor: Actor,
    id: string,
    action: string,
    allowed: Allowed,
  ) {
    const [row] = await tx
      .select({ id: principal.id })
      .from(principal)
      .where(
        and(
          eq(principal.id, actor.principalId),
          eq(principal.tenantId, actor.tenantId),
          eq(principal.status, "active"),
        ),
      );
    if (!row || !(await allowed(projectResource(id), action)))
      throw new ProjectError(403, "forbidden");
  }
  async function load(
    tx: DBExecutor,
    actor: Actor,
    id: string,
    lock?: "update",
  ) {
    const query = tx
      .select()
      .from(project)
      .where(and(eq(project.id, id), eq(project.tenantId, actor.tenantId)));
    const [row] = await (lock ? query.for(lock) : query);
    if (!row) throw new ProjectError(404, "project_not_found");
    return row;
  }
  async function childTenant(
    createTenant: CreateTenant,
    name: string,
    parentId: string,
  ) {
    for (let attempt = 1; ; attempt++) {
      try {
        return await createTenant({ name, slug: threeWordSlug(), parentId });
      } catch (error) {
        if (
          attempt >= SLUG_ATTEMPTS ||
          !(error instanceof ProjectError) ||
          error.code !== "tenant_slug_taken"
        )
          throw error;
      }
    }
  }

  const service = {
    async read(actor: Actor, rawId: unknown) {
      const id = ProjectId(rawId);
      if (id instanceof type.errors)
        throw new ProjectError(400, "invalid_project_id");
      const allowed = await authorizationFor(actor);
      return db.transaction(async (tx) => {
        await requireActor(tx, actor, id, "read", allowed);
        const row = await load(tx, actor, id);
        // Lineage is read, never inherited: a version names its source only.
        const [source] = row.versionOfProjectId
          ? await tx
              .select({ id: project.id, title: project.title })
              .from(project)
              .where(eq(project.id, row.versionOfProjectId))
          : [];
        const [coordinator] = await tx
          .select({ runId: projectCoordinator.runId })
          .from(projectCoordinator)
          .where(
            and(
              eq(projectCoordinator.projectId, id),
              eq(projectCoordinator.active, true),
            ),
          );
        return ProjectView.assert({
          projectId: id,
          tenantId: row.tenantId,
          title: row.title,
          status: row.status,
          coordinatorRunId: coordinator?.runId ?? null,
          ...(source
            ? { versionOf: { projectId: source.id, title: source.title } }
            : {}),
        });
      });
    },
    // Lists the workspace's project tenants in which the user holds an active
    // principal with a read grant; other projects are absent, never redacted.
    async list(
      workspace: Actor,
      userId: string | undefined,
      rawStatus: string | undefined,
    ) {
      const status = parseStatusFilter(rawStatus);
      if (!userId) throw new ProjectError(403, "forbidden");
      const member = and(
        eq(principal.kind, "user"),
        eq(principal.refId, userId),
        eq(principal.status, "active"),
      );
      // The runs of the projects the user is a member of: whether any was a coder's, and the latest
      // a run started or ended. Interchange keeps run times as UTC without a zone.
      const runs = db
        .select({
          tenantId: workflowRun.tenantId,
          coderRan: sql<
            boolean | null
          >`bool_or(${workflowRoleSql(workflowRunLaunchSpec.frozenApprovalBundle)} = 'coder')`.as(
            "coder_ran",
          ),
          lastRunAt:
            sql`max(greatest(${workflowRun.createdAt}, ${workflowRun.endedAt})) at time zone 'UTC'`.as(
              "last_run_at",
            ),
        })
        .from(workflowRun)
        .leftJoin(
          workflowRunLaunchSpec,
          eq(workflowRunLaunchSpec.anchorRunId, workflowRun.id),
        )
        .where(
          inArray(
            workflowRun.tenantId,
            db
              .select({ tenantId: principal.tenantId })
              .from(principal)
              .innerJoin(tenant, eq(tenant.id, principal.tenantId))
              .where(and(member, eq(tenant.parentId, workspace.tenantId))),
          ),
        )
        .groupBy(workflowRun.tenantId)
        .as("runs");
      const artifacts = sql.identifier(ARTIFACTS_SCHEMA);
      const lastActivityAt =
        sql`greatest(${project.updatedAt}, ${runs.lastRunAt}, (select max(updated_at) from ${artifacts}.artifact where tenant_id = ${project.tenantId} and archived_at is null))`.mapWith(
          project.updatedAt,
        );
      const rows = await db
        .select({
          project,
          principalId: principal.id,
          coordinatorRunId: projectCoordinator.runId,
          coderRan: runs.coderRan,
          lastActivityAt,
        })
        .from(project)
        .innerJoin(tenant, eq(tenant.id, project.tenantId))
        .leftJoin(runs, eq(runs.tenantId, project.tenantId))
        .leftJoin(
          projectCoordinator,
          and(
            eq(projectCoordinator.projectId, project.id),
            eq(projectCoordinator.active, true),
          ),
        )
        .innerJoin(
          principal,
          and(eq(principal.tenantId, project.tenantId), member),
        )
        .where(
          and(
            eq(tenant.parentId, workspace.tenantId),
            status === "all" ? undefined : eq(project.status, status),
          ),
        )
        .orderBy(project.createdAt, project.id);
      const projects = [];
      for (const row of rows) {
        const allowed = await authorizationFor({
          tenantId: row.project.tenantId,
          principalId: row.principalId,
        });
        if (!(await allowed(projectResource(row.project.id), "read"))) continue;
        projects.push({
          projectId: row.project.id,
          tenantId: row.project.tenantId,
          title: row.project.title,
          status: ProjectLifecycleStatus.assert(row.project.status),
          stage: row.project.shippedAt
            ? "shipped"
            : row.coderRan
              ? "building"
              : "idea",
          shippedAt: row.project.shippedAt?.toISOString() ?? null,
          coordinatorRunId: row.coordinatorRunId,
          createdAt: row.project.createdAt.toISOString(),
          updatedAt: row.project.updatedAt.toISOString(),
          lastActivityAt: row.lastActivityAt.toISOString(),
        });
      }
      return ProjectSummaryList.assert({ projects });
    },
    async lifecycle(
      actor: Actor,
      rawId: unknown,
      target: "archived" | "active",
    ) {
      const id = ProjectId(rawId);
      if (id instanceof type.errors)
        throw new ProjectError(400, "invalid_project_id");
      const allowed = await authorizationFor(actor);
      return db.transaction(async (tx) => {
        await requireActor(tx, actor, id, "manage", allowed);
        const row = await load(tx, actor, id, "update");
        if (row.status !== target) {
          await tx
            .update(project)
            .set({ status: target, updatedAt: new Date() })
            .where(eq(project.id, id));
          await tx.insert(outbox).values({
            id: crypto.randomUUID(),
            projectId: id,
            eventType:
              target === "archived" ? "project.archived" : "project.restored",
            payload: { schemaVersion: 1, actorPrincipalId: actor.principalId },
          });
        }
        return ProjectLifecycleReceipt.assert({
          ok: true,
          projectId: id,
          status: target,
        });
      });
    },
    // Shipped is the person's mark only: the project stays active, so nothing it allows changes.
    async ship(actor: Actor, rawId: unknown, shipped: boolean) {
      const id = ProjectId(rawId);
      if (id instanceof type.errors)
        throw new ProjectError(400, "invalid_project_id");
      const allowed = await authorizationFor(actor);
      return db.transaction(async (tx) => {
        await requireActor(tx, actor, id, "manage", allowed);
        const row = await load(tx, actor, id, "update");
        if (row.status !== "active")
          throw new ProjectError(409, "project_archived");
        let shippedAt = row.shippedAt;
        if ((shippedAt !== null) !== shipped) {
          const now = new Date();
          shippedAt = shipped ? now : null;
          await tx
            .update(project)
            .set({ shippedAt, updatedAt: now })
            .where(eq(project.id, id));
          await tx.insert(outbox).values({
            id: crypto.randomUUID(),
            projectId: id,
            eventType: shipped ? "project.shipped" : "project.reopened",
            payload: { schemaVersion: 1, actorPrincipalId: actor.principalId },
          });
        }
        return ProjectShipReceipt.assert({
          ok: true,
          projectId: id,
          shippedAt: shippedAt?.toISOString() ?? null,
        });
      });
    },
  };

  // Returns the receipt body plus the caller's principal in the affected
  // project's tenant, which a new project's coordinator deploys under.
  async function mutateProject(
    caller: ProjectCaller,
    createTenant: CreateTenant | undefined,
    rawId: unknown,
    input: unknown,
  ): Promise<{
    body: string;
    projectId: string;
    actor: Actor;
    opening?: string;
  }> {
    const id = ProjectId(rawId);
    const mutation = ProjectMutation(input);
    if (id instanceof type.errors)
      throw new ProjectError(400, "invalid_project_mutation");
    if (mutation instanceof type.errors)
      throw new ProjectError(400, "invalid_project_mutation", {
        issues: typeIssues(mutation),
      });
    if (
      mutation.command === "version_project" &&
      mutation.payload.sourceProjectId !== id
    )
      throw new ProjectError(400, "source_project_mismatch");
    // The receipt scope excludes the project id, so the digest binds it.
    const payloadSha256 = digest({ projectId: id, payload: mutation.payload });
    const scope = and(
      eq(mutationReceipt.tenantId, caller.tenantId),
      eq(mutationReceipt.actorPrincipalId, caller.principalId),
      eq(mutationReceipt.command, mutation.command),
      eq(mutationReceipt.idempotencyKey, mutation.idempotencyKey),
    );
    const record = async (
      tx: DBExecutor,
      actor: Actor,
      projectId: string,
      eventType: "project.created" | "project.updated",
      sourceProjectId?: string,
    ) => {
      const resultBody = JSON.stringify(
        ProjectMutationReceipt.assert({
          ok: true,
          mutationId: mutation.mutationId,
          projectId,
        }),
      );
      await tx.insert(outbox).values({
        id: crypto.randomUUID(),
        projectId,
        eventType,
        payload: {
          schemaVersion: 1,
          mutationId: mutation.mutationId,
          actorPrincipalId: actor.principalId,
          ...(sourceProjectId ? { sourceProjectId } : {}),
        },
      });
      await tx.insert(mutationReceipt).values({
        tenantId: actor.tenantId,
        actorPrincipalId: actor.principalId,
        command: mutation.command,
        idempotencyKey: mutation.idempotencyKey,
        payloadSha256,
        resultBody,
      });
      return { body: resultBody, projectId, actor };
    };
    const replay = async (resultBody: string, payload: string) => {
      if (payload !== payloadSha256)
        throw new ProjectError(409, "idempotency_key_reuse");
      const receipt = ProjectMutationReceipt.assert(JSON.parse(resultBody));
      return {
        body: resultBody,
        projectId: receipt.projectId,
        actor: await actorIn(receipt.projectId),
      };
    };
    const actorIn = async (projectId: string): Promise<Actor> => {
      if (mutation.command === "rename_project") return caller;
      const [row] = await db
        .select({ tenantId: project.tenantId })
        .from(project)
        .where(eq(project.id, projectId));
      const member =
        row && caller.userId
          ? await userPrincipalIn(db, row.tenantId, caller.userId)
          : undefined;
      if (!row || !member)
        throw new ProjectError(403, "project_membership_missing");
      return { tenantId: row.tenantId, principalId: member.id };
    };
    const [prior] = await db.select().from(mutationReceipt).where(scope);
    if (prior) return replay(prior.resultBody, prior.payloadSha256);

    const allowed = await authorizationFor(caller);
    if (mutation.command === "rename_project")
      return db.transaction(async (tx) => {
        await requireActor(tx, caller, id, "manage", allowed);
        const row = await load(tx, caller, id, "update");
        if (row.status !== "active")
          throw new ProjectError(409, "project_archived");
        await tx
          .update(project)
          .set({ title: mutation.payload.title, updatedAt: new Date() })
          .where(eq(project.id, id));
        return record(tx, caller, id, "project.updated");
      });

    // A new project is a new native child tenant of the workspace. The tenant
    // is created before the row because Interchange owns its creation; a lost
    // race on the same idempotency key leaves an empty tenant, never a project.
    if (!createTenant)
      throw new ProjectError(503, "tenant_creation_unavailable");
    let parentId: string;
    let createdId: string;
    let sourceId: string | undefined;
    if (mutation.command === "create_project") {
      await requireActor(db, caller, id, "create", allowed);
      const [taken] = await db
        .select({ id: project.id })
        .from(project)
        .where(eq(project.id, id));
      if (taken) throw new ProjectError(409, "project_already_exists");
      parentId = caller.tenantId;
      createdId = id;
    } else {
      await requireActor(db, caller, id, "manage", allowed);
      const source = await load(db, caller, id);
      if (source.status !== "active")
        throw new ProjectError(409, "project_archived");
      if (!caller.parentTenantId)
        throw new ProjectError(409, "project_workspace_missing");
      parentId = caller.parentTenantId;
      createdId = `v-${crypto.randomUUID().replaceAll("-", "")}`;
      sourceId = id;
    }
    const child = await childTenant(
      createTenant,
      mutation.payload.title,
      parentId,
    );
    const result = await db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${canonicalJsonStringify([caller.tenantId, caller.principalId, mutation.command, mutation.idempotencyKey])}, 0))`,
      );
      const [raced] = await tx.select().from(mutationReceipt).where(scope);
      if (raced) return { ...raced, committed: false };
      const inserted = await tx
        .insert(project)
        .values({
          id: createdId,
          tenantId: child.id,
          title: mutation.payload.title,
          versionOfProjectId: sourceId ?? null,
        })
        .onConflictDoNothing()
        .returning({ id: project.id });
      if (inserted.length !== 1)
        throw new ProjectError(409, "project_already_exists");
      // The project starts with its creator's preferences and model profile (a version, with its
      // source's), so a later change in Settings never alters how a running project is driven. Without
      // a profile this server can run, the coordinator's start resolves one (model-choice.ts).
      const { preferences, models } = sourceId
        ? await loadSettings(tx, caller.tenantId, sourceId)
        : await loadSettingsAt(
            tx,
            caller.tenantId,
            personalScopeKey(caller.principalId),
          );
      const picked =
        mutation.command === "create_project"
          ? mutation.payload.profile
          : undefined;
      const choice = picked
        ? pickedModelChoice(models.value, picked)
        : models.value;
      if (picked && !choice)
        throw new ProjectError(400, "model_profile_unknown", {
          profile: picked,
        });
      await tx.insert(settingsRecord).values({
        tenantId: child.id,
        scopeKey: `project:${createdId}`,
        projectId: createdId,
        fields: {
          ...defaultSettings(),
          preferences: {
            value: resolvePreferences(preferences.value),
            version: 1,
          },
          models: { value: frozenModelChoice(choice), version: 1 },
        },
      });
      const recorded = await record(
        tx,
        caller,
        createdId,
        "project.created",
        sourceId,
      );
      return { resultBody: recorded.body, payloadSha256, committed: true };
    });
    const created = await replay(result.resultBody, result.payloadSha256);
    // Only the request that committed the project carries its opening idea on, so a replayed
    // receipt never mails it twice.
    const opening: string | undefined =
      result.committed && mutation.command === "create_project"
        ? mutation.payload.problemStatement
        : undefined;
    return { ...created, ...(opening === undefined ? {} : { opening }) };
  }
  return { ...service, mutate: mutateProject };
}
