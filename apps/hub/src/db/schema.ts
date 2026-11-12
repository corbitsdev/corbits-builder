import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  type AnyPgColumn,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import {
  approval,
  modelProvider,
  principal,
  tenant,
  workflowRun,
} from "@intx/db/schema";
import type { CustomModel } from "@corbits-builder/schemas/models";
import type { StoredPlan } from "@corbits-builder/schemas/project";

export const project = pgTable(
  "project",
  {
    id: text("id").primaryKey(),
    // The project's own Interchange child tenant; it holds the project's
    // principals, artifacts, approvals and runs.
    tenantId: text("tenant_id")
      .notNull()
      .unique()
      .references(() => tenant.id),
    title: text("title").notNull(),
    status: text("status").notNull().default("active"),
    versionOfProjectId: text("version_of_project_id").references(
      (): AnyPgColumn => project.id,
    ),
    // The person's own mark, apart from the lifecycle: a shipped project stays active and usable.
    shippedAt: timestamp("shipped_at", { withTimezone: true }),
    // The handles of the route plugins the project follows, each until its outcome holds or the
    // coordinator leaves it.
    routes: text("routes").array().notNull().default([]),
    // Each project value a plugin declares, by name, as the person saved it; the look values live
    // in the design's tokens instead.
    values: jsonb("values")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    // The saved plan; null until the coordinator or the person first saves one.
    plan: jsonb("plan").$type<StoredPlan>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      "project_status_check",
      sql`${table.status} in ('active', 'archived')`,
    ),
  ],
);

export const outbox = pgTable(
  "outbox",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => project.id),
    eventType: text("event_type").notNull(),
    payload: jsonb("payload").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
  },
  (table) => [
    index("sb_outbox_project_time_id_idx").on(
      table.projectId,
      table.occurredAt,
      table.id,
    ),
  ],
);

export const mutationReceipt = pgTable(
  "mutation_receipt",
  {
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenant.id),
    actorPrincipalId: text("actor_principal_id")
      .notNull()
      .references(() => principal.id),
    command: text("command").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    payloadSha256: text("payload_sha256").notNull(),
    // Preserve the future envelope's serialized response, not a JSONB rewrite.
    resultBody: text("result_body").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [
        table.tenantId,
        table.actorPrincipalId,
        table.command,
        table.idempotencyKey,
      ],
    }),
  ],
);

export { deviceCode, deviceSession } from "../auth.ts";

// The exact artifact versions and hashes a resolved deploy approval covered,
// recorded once, when its deploy first runs.
export const artifactApproval = pgTable(
  "sb_artifact_approval",
  {
    approvalId: text("approval_id")
      .notNull()
      .references(() => approval.id),
    artifactId: text("artifact_id").notNull(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenant.id),
    projectId: text("project_id")
      .notNull()
      .references(() => project.id),
    tool: text("tool").notNull(),
    kind: text("kind").notNull(),
    version: integer("version").notNull(),
    sha256: text("sha256").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.approvalId, t.artifactId] }),
    index("sb_artifact_approval_artifact_idx").on(
      t.tenantId,
      t.artifactId,
      t.version,
    ),
  ],
);

// Importing a project file and choosing a design option are the person's own
// decisions, so no native approval exists to reference; the row names that person instead.
export const artifactImportApproval = pgTable(
  "sb_artifact_import_approval",
  {
    artifactId: text("artifact_id").notNull(),
    version: integer("version").notNull(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenant.id),
    projectId: text("project_id")
      .notNull()
      .references(() => project.id),
    principalId: text("principal_id")
      .notNull()
      .references(() => principal.id),
    kind: text("kind").notNull(),
    sha256: text("sha256").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.artifactId, t.version] }),
    index("sb_artifact_import_approval_tenant_idx").on(
      t.tenantId,
      t.artifactId,
    ),
  ],
);

// A host-authenticated registration binds one native deployment to one project.
// Retired bindings remain so an old run/token cannot migrate into another project.
export const projectCoordinator = pgTable(
  "project_coordinator",
  {
    runId: text("run_id")
      .primaryKey()
      .references(() => workflowRun.id),
    projectId: text("project_id")
      .notNull()
      .references(() => project.id),
    active: boolean("active").notNull().default(true),
    registeredBy: text("registered_by")
      .notNull()
      .references(() => principal.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("project_coordinator_active_project_idx")
      .on(t.projectId)
      .where(sql`${t.active}`),
  ],
);

// Each ended run of a project the hub has looked at, once, for a specialist that stopped before it
// delivered its result. `notified` records that the coordinator was mailed about it.
export const endedRun = pgTable("sb_ended_run", {
  runId: text("run_id")
    .primaryKey()
    .references(() => workflowRun.id),
  projectId: text("project_id")
    .notNull()
    .references(() => project.id),
  notified: boolean("notified").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// The design concept a designer run was deployed for. The hub files that run's design as the
// concept's option, so a concept is never a model-authored argument of the filing call.
export const designConcept = pgTable(
  "sb_design_concept",
  {
    runId: text("run_id")
      .primaryKey()
      .references(() => workflowRun.id),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenant.id),
    projectId: text("project_id")
      .notNull()
      .references(() => project.id),
    label: text("label").notNull(),
    direction: text("direction").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("sb_design_concept_tenant_idx").on(t.tenantId, t.label)],
);

// The plugin action the coordinator started a specialist run for, recorded before the run's
// assignment. It is what lists the run among the coordinator's, lets the coordinator stop it, and
// names the project values the run may save.
export const runAction = pgTable(
  "sb_run_action",
  {
    runId: text("run_id")
      .primaryKey()
      .references(() => workflowRun.id),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenant.id),
    projectId: text("project_id")
      .notNull()
      .references(() => project.id),
    plugin: text("plugin").notNull(),
    action: text("action").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("sb_run_action_project_idx").on(t.projectId)],
);

// One run of a plugin's check against the project as saved, or a person's skip of one. versions
// names what it read, each at the version it read, so a pass stands only while all of it is current.
export const checkRun = pgTable(
  "sb_check_run",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenant.id),
    projectId: text("project_id")
      .notNull()
      .references(() => project.id),
    plugin: text("plugin").notNull(),
    action: text("action").notNull(),
    input: jsonb("input").$type<Record<string, unknown>>().notNull(),
    versions: jsonb("versions")
      .$type<Record<string, string | number | boolean | null>>()
      .notNull(),
    result: text("result").$type<"pass" | "fail" | "skipped">().notNull(),
    summary: text("summary").notNull(),
    evidence: jsonb("evidence").$type<string[]>().notNull(),
    // "person:<principal id>", "run:<coordinator run id>" or "hub".
    triggeredBy: text("triggered_by").notNull(),
    skippedBy: text("skipped_by").references(() => principal.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("sb_check_run_project_idx").on(
      t.projectId,
      t.plugin,
      t.action,
      t.createdAt,
    ),
    check(
      "sb_check_run_result_check",
      sql`${t.result} in ('pass', 'fail', 'skipped')`,
    ),
  ],
);

// Invitation lifecycle is product audit data. Identity, role assignments and
// effective authority remain native Interchange rows, created only on acceptance.
export const invitation = pgTable(
  "sb_invitation",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenant.id),
    email: text("email").notNull(),
    roleId: text("role_id").notNull(),
    roleSha256: text("role_sha256").notNull(),
    invitedBy: text("invited_by").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    payloadSha256: text("payload_sha256").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    acceptedPrincipalId: text("accepted_principal_id"),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedBy: text("revoked_by"),
  },
  (t) => [
    unique().on(t.tenantId, t.invitedBy, t.idempotencyKey),
    index("sb_invitation_recipient_idx").on(t.email, t.createdAt),
    check(
      "sb_invitation_terminal_check",
      sql`NOT (${t.acceptedAt} IS NOT NULL AND ${t.revokedAt} IS NOT NULL)`,
    ),
    check(
      "sb_invitation_acceptance_check",
      sql`(${t.acceptedAt} IS NULL) = (${t.acceptedPrincipalId} IS NULL)`,
    ),
    check(
      "sb_invitation_revocation_check",
      sql`(${t.revokedAt} IS NULL) = (${t.revokedBy} IS NULL)`,
    ),
  ],
);

export const settingsRecord = pgTable(
  "sb_settings",
  {
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenant.id),
    scopeKey: text("scope_key").notNull(),
    projectId: text("project_id").references(() => project.id),
    fields: jsonb("fields")
      .$type<import("@corbits-builder/schemas/settings").SettingsFields>()
      .notNull(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.scopeKey] })],
);

// A person's own endpoint: its name and models, and the catalog connection it runs
// on, which holds its base URL and key. Its id is what profiles bind, so it survives moving to a
// new connection.
export const customModelProvider = pgTable("sb_custom_model_provider", {
  id: text("id").primaryKey(),
  modelProviderId: text("model_provider_id")
    .notNull()
    .unique()
    .references(() => modelProvider.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  models: jsonb("models").$type<CustomModel[]>().notNull(),
  // Its connection carries a placeholder in place of a key; the placeholder itself is never shown.
  keyless: boolean("keyless").notNull(),
});

// Sharing an approval package starts a review round in the hub without parking a long-lived
// workflow on a sidecar. Reviewer decisions and triaged items stay here until the owner acts.
export const approvalRound = pgTable(
  "sb_approval_round",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenant.id),
    projectId: text("project_id")
      .notNull()
      .references(() => project.id),
    artifactId: text("artifact_id").notNull(),
    packageVersion: integer("package_version").notNull(),
    packageSha256: text("package_sha256").notNull(),
    startedBy: text("started_by")
      .notNull()
      .references(() => principal.id),
    expiryPreset: text("expiry_preset").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    settledAt: timestamp("settled_at", { withTimezone: true }),
    reviewers: jsonb("reviewers").notNull(),
    triage: jsonb("triage").notNull().default([]),
    triggeredRunId: text("triggered_run_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("sb_approval_round_project_idx").on(
      t.tenantId,
      t.projectId,
      t.createdAt,
    ),
  ],
);
