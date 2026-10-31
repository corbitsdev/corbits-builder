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
import { approval, principal, tenant, workflowRun } from "@intx/db/schema";

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
