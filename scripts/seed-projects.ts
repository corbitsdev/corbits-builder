import {
  MAX_LIST_LIMIT,
  createArtifact,
  getArtifactVersion,
  listArtifacts,
  type ArtifactDb,
} from "@corbits/artifacts";
import { readHubEnvironment } from "@corbits-builder/hub/environment";
import { migrateDatabase } from "@corbits-builder/hub/migrate";
import { appBuilt } from "@corbits-builder/hub/artifacts/service";
import type { ApproachesMeta } from "@corbits-builder/schemas/approaches";
import {
  ApprovalRound,
  type ApprovalRound as ApprovalRoundType,
  type ExpiryPreset,
  type WorkspaceReviewer,
} from "@corbits-builder/schemas/approval-round";
import {
  AppBundle,
  ApprovalPackageBundle,
  DesignBundle,
  DocumentWrite,
  type ApprovalPackageSource,
  type ArtifactContent,
  type ArtifactList,
  type ArtifactListItem,
  type ArtifactRef,
  type DesignChoiceReceipt,
} from "@corbits-builder/schemas/artifact";
import type { ProjectShipReceipt } from "@corbits-builder/schemas/project";
import { createEnvKeyCredentialCipher } from "@intx/crypto";
import {
  createDB,
  createPrincipalKeyStore,
  createPrincipalStore,
  type DB,
  type PrincipalKeyStore,
} from "@intx/db";
import {
  grant,
  principal,
  principalRole,
  role,
  tenant,
  user,
} from "@intx/db/schema";
import { generateId } from "@intx/hub-common";
import { hexDecode } from "@intx/types";
import { and, asc, eq, isNull, ne, or, sql } from "drizzle-orm";
import {
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import {
  SEED_FIXTURE_IDS,
  SEED_PROJECT_FIXTURES,
  SEED_STAGES,
  SEED_WORKSPACE_REVIEWERS,
  getSeedProjectFixture,
  loadSeedProjectFixture,
  loadSeedProjectFixtures,
  resolveSeedFixtures,
  type SeedApprovalPackageFixture,
  type SeedApprovalRoundMetadata,
  type SeedDesignOptionFixture,
  type SeedFixtureId,
  type SeedFixtureSelector,
  type SeedProjectFixture,
  type SeedStage,
} from "../test/seed/index.ts";

export {
  SEED_FIXTURE_IDS,
  SEED_PROJECT_FIXTURES,
  SEED_STAGES,
  getSeedProjectFixture,
  loadSeedProjectFixture,
  loadSeedProjectFixtures,
  resolveSeedFixtures,
  type SeedApprovalPackageFixture,
  type SeedApprovalRoundMetadata,
  type SeedDesignOptionFixture,
  type SeedFixtureId,
  type SeedFixtureSelector,
  type SeedProjectFixture,
  type SeedStage,
};

export interface SeedActor {
  tenantId: string;
  principalId: string;
}

const INSTALL_ROOT_SLUG = "corbits-builder";
const SYSTEM_ROLES = ["owner", "admin", "member"] as const;
const DEFAULT_DEV_USER = {
  email: "dev@corbits.local",
  name: "Local Developer",
  workspaceName: "Development Workspace",
  workspaceSlug: "dev-workspace",
} as const;

const EXPIRY_MS: Readonly<Record<ExpiryPreset, number>> = {
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
};

const projectTable = pgTable("project", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  title: text("title").notNull(),
  status: text("status").notNull().default("active"),
  shippedAt: timestamp("shipped_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

const outboxTable = pgTable("outbox", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  eventType: text("event_type").notNull(),
  payload: jsonb("payload").notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

const artifactImportApprovalTable = pgTable(
  "sb_artifact_import_approval",
  {
    artifactId: text("artifact_id").notNull(),
    version: integer("version").notNull(),
    tenantId: text("tenant_id").notNull(),
    projectId: text("project_id").notNull(),
    principalId: text("principal_id").notNull(),
    kind: text("kind").notNull(),
    sha256: text("sha256").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.artifactId, table.version] })],
);

const approvalRoundTable = pgTable("sb_approval_round", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  projectId: text("project_id").notNull(),
  artifactId: text("artifact_id").notNull(),
  packageVersion: integer("package_version").notNull(),
  packageSha256: text("package_sha256").notNull(),
  startedBy: text("started_by").notNull(),
  expiryPreset: text("expiry_preset").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  settledAt: timestamp("settled_at", { withTimezone: true }),
  reviewers: jsonb("reviewers").notNull(),
  triage: jsonb("triage").notNull().default([]),
  triggeredRunId: text("triggered_run_id"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

const settingsTable = pgTable(
  "sb_settings",
  {
    tenantId: text("tenant_id").notNull(),
    scopeKey: text("scope_key").notNull(),
    fields: jsonb("fields").notNull(),
  },
  (table) => [primaryKey({ columns: [table.tenantId, table.scopeKey] })],
);

export interface ResolvedWorkspaceTenant {
  tenantId: string;
  principalId: string;
  userId: string;
}

export interface CreatedSeedProject {
  projectId: string;
  actor: SeedActor;
}

export interface SeedArtifactWriteInput {
  kind: string;
  title: string;
  content: string;
  openQuestions?: NonNullable<ArtifactContent["openQuestions"]>;
  approaches?: ApproachesMeta;
}

export interface SeedApprovalRoundInput {
  artifactId: string;
  packageVersion: number;
  packageSha256: string;
  round: SeedApprovalRoundMetadata;
}

export interface SeedDeps {
  resolveWorkspaceTenant(tenantId?: string): Promise<ResolvedWorkspaceTenant>;
  seedWorkspaceReviewers(
    workspace: ResolvedWorkspaceTenant,
    reviewers: readonly WorkspaceReviewer[],
  ): Promise<void>;
  createProject(
    workspace: ResolvedWorkspaceTenant,
    input: {
      fixtureId: SeedFixtureId;
      title: string;
      problemStatement: string;
    },
  ): Promise<CreatedSeedProject>;
  writeArtifact(
    actor: SeedActor,
    projectId: string,
    input: SeedArtifactWriteInput,
  ): Promise<ArtifactRef>;
  recordArtifactApproval(
    actor: SeedActor,
    projectId: string,
    ref: ArtifactRef,
  ): Promise<void>;
  chooseDesign(
    actor: SeedActor,
    projectId: string,
    input: { artifactId: string; version: number },
  ): Promise<DesignChoiceReceipt>;
  seedApprovalRound(
    actor: SeedActor,
    projectId: string,
    input: SeedApprovalRoundInput,
  ): Promise<ApprovalRoundType>;
  shipProject(actor: SeedActor, projectId: string): Promise<ProjectShipReceipt>;
  listArtifacts(actor: SeedActor, projectId: string): Promise<ArtifactList>;
}

export interface SeedDevelopmentProjectsOptions {
  fixture?: SeedFixtureSelector;
  stage?: SeedStage;
  approve?: boolean;
  tenantId?: string;
}

export interface SeededProjectSummary {
  fixtureId: SeedFixtureId;
  complexity: SeedProjectFixture["complexity"];
  projectId: string;
  projectTenantId: string;
  projectPrincipalId: string;
  workspaceTenantId: string;
  title: string;
  stage: SeedStage;
  shippedAt: string | null;
  artifacts: ArtifactListItem[];
  awaitingApproval: string[];
  approvalRound?: ApprovalRoundType;
}

export interface SeedDevelopmentProjectsResult {
  workspaceTenantId: string;
  stage: SeedStage | undefined;
  approve: boolean;
  projects: SeededProjectSummary[];
}

const STAGE_ORDER: Record<SeedStage, number> = {
  idea: 0,
  brief: 1,
  planning: 2,
  design_options: 3,
  designed: 4,
  ready_to_build: 5,
  shipped: 6,
};

function reachesStage(target: SeedStage, candidate: SeedStage): boolean {
  return STAGE_ORDER[target] >= STAGE_ORDER[candidate];
}

function isPastStage(target: SeedStage, candidate: SeedStage): boolean {
  return STAGE_ORDER[target] > STAGE_ORDER[candidate];
}

export async function seedDevelopmentProjects(
  deps: SeedDeps,
  options: SeedDevelopmentProjectsOptions = {},
): Promise<SeedDevelopmentProjectsResult> {
  const selector: SeedFixtureSelector = options.fixture ?? "all";
  const approve: boolean = options.approve ?? true;
  const fixtures = await loadSeedProjectFixtures(selector);
  const workspace = await deps.resolveWorkspaceTenant(options.tenantId);
  await deps.seedWorkspaceReviewers(workspace, SEED_WORKSPACE_REVIEWERS);

  const projects: SeededProjectSummary[] = [];

  for (const fixture of fixtures) {
    const stage: SeedStage =
      options.stage === undefined ? fixture.defaultStage : options.stage;
    const created = await deps.createProject(workspace, {
      fixtureId: fixture.id,
      title: fixture.title,
      problemStatement: fixture.problemStatement,
    });
    const { actor, projectId } = created;
    const docs = fixture.documents;
    const sourcePins: ApprovalPackageSource[] = [];

    if (reachesStage(stage, "brief")) {
      const briefRef = await deps.writeArtifact(actor, projectId, {
        kind: "problem_brief",
        title: docs.problem_brief.title,
        content: docs.problem_brief.content,
      });
      sourcePins.push({ ...briefRef, title: docs.problem_brief.title });
      if (approve || isPastStage(stage, "brief")) {
        await deps.recordArtifactApproval(actor, projectId, briefRef);
      }
    }

    if (reachesStage(stage, "planning")) {
      const constraintsRef = await deps.writeArtifact(actor, projectId, {
        kind: "constraints",
        title: docs.constraints.title,
        content: docs.constraints.content,
      });
      sourcePins.push({ ...constraintsRef, title: docs.constraints.title });
      const approachesRef = await deps.writeArtifact(actor, projectId, {
        kind: "approaches",
        title: docs.approaches.title,
        content: docs.approaches.content,
        approaches: docs.approaches.approaches,
      });
      sourcePins.push({ ...approachesRef, title: docs.approaches.title });
      const prdRef = await deps.writeArtifact(actor, projectId, {
        kind: "product_requirements",
        title: docs.product_requirements.title,
        content: docs.product_requirements.content,
      });
      sourcePins.push({
        ...prdRef,
        title: docs.product_requirements.title,
      });
      if (approve || isPastStage(stage, "planning")) {
        await deps.recordArtifactApproval(actor, projectId, constraintsRef);
        await deps.recordArtifactApproval(actor, projectId, approachesRef);
        await deps.recordArtifactApproval(actor, projectId, prdRef);
      }
    }

    let pickedDesignOptionRef: ArtifactRef | undefined;
    if (reachesStage(stage, "design_options")) {
      for (const option of fixture.designOptions) {
        const optionRef = await deps.writeArtifact(actor, projectId, {
          kind: "design_option",
          title: option.title,
          content: JSON.stringify(option.bundle),
        });
        if (
          option.title === fixture.chosenDesignOption ||
          option.conceptId === fixture.chosenConceptId
        ) {
          pickedDesignOptionRef = optionRef;
        }
      }
    }

    if (reachesStage(stage, "designed")) {
      if (!pickedDesignOptionRef) {
        throw new Error(
          `Fixture ${fixture.id} is missing chosen design option "${fixture.chosenDesignOption}"`,
        );
      }
      const chosenDesign = await deps.chooseDesign(actor, projectId, {
        artifactId: pickedDesignOptionRef.artifactId,
        version: pickedDesignOptionRef.version,
      });
      sourcePins.push({
        ...chosenDesign.design,
        title: chosenDesign.concept,
      });
    }

    if (reachesStage(stage, "ready_to_build")) {
      const buildPlanRef = await deps.writeArtifact(actor, projectId, {
        kind: "build_plan",
        title: docs.build_plan.title,
        content: docs.build_plan.content,
      });
      sourcePins.push({ ...buildPlanRef, title: docs.build_plan.title });
      if (approve || isPastStage(stage, "ready_to_build")) {
        await deps.recordArtifactApproval(actor, projectId, buildPlanRef);
      }
    }

    let approvalRound: ApprovalRoundType | undefined;
    if (
      reachesStage(stage, "ready_to_build") &&
      fixture.approvalPackage !== undefined
    ) {
      const livePackageBundle = ApprovalPackageBundle.assert({
        ...fixture.approvalPackage.bundle,
        manifest: {
          ...fixture.approvalPackage.bundle.manifest,
          sources:
            sourcePins.length > 0
              ? sourcePins
              : fixture.approvalPackage.bundle.manifest.sources,
        },
      });
      const packageRef = await deps.writeArtifact(actor, projectId, {
        kind: "approval_package",
        title: fixture.approvalPackage.title,
        content: JSON.stringify(livePackageBundle),
      });
      if (fixture.approvalRound !== undefined) {
        await deps.recordArtifactApproval(actor, projectId, packageRef);
        approvalRound = await deps.seedApprovalRound(actor, projectId, {
          artifactId: packageRef.artifactId,
          packageVersion: packageRef.version,
          packageSha256: packageRef.sha256,
          round: fixture.approvalRound,
        });
      }
    }

    let shippedAt: string | null = null;
    if (reachesStage(stage, "shipped")) {
      await deps.writeArtifact(actor, projectId, {
        kind: "app",
        title: "App",
        content: JSON.stringify(fixture.app),
      });
      const shipReceipt = await deps.shipProject(actor, projectId);
      shippedAt = shipReceipt.shippedAt;
    }

    const listed = await deps.listArtifacts(actor, projectId);
    projects.push({
      fixtureId: fixture.id,
      complexity: fixture.complexity,
      projectId,
      projectTenantId: actor.tenantId,
      projectPrincipalId: actor.principalId,
      workspaceTenantId: workspace.tenantId,
      title: fixture.title,
      stage,
      shippedAt,
      artifacts: listed.artifacts,
      awaitingApproval: listed.awaitingApproval,
      ...(approvalRound === undefined ? {} : { approvalRound }),
    });
  }

  return {
    workspaceTenantId: workspace.tenantId,
    stage: options.stage,
    approve,
    projects,
  };
}

async function provisionChildTenant(
  db: DB["db"],
  principalKeyStore: PrincipalKeyStore,
  userId: string,
  body: { name: string; slug: string; parentId: string | null },
): Promise<{ id: string; principalId: string }> {
  const principalStore = createPrincipalStore(db, principalKeyStore);
  const existing = await db.query.tenant.findFirst({
    where: eq(sql`lower(${tenant.slug})`, body.slug.toLowerCase()),
  });
  if (existing) {
    throw new Error(`Tenant slug already taken: ${body.slug}`);
  }

  const tenantId = generateId("tenant");
  const domain = `${body.slug.toLowerCase()}.localhost`;
  const now = new Date();

  return db.transaction(async (tx) => {
    await tx.insert(tenant).values({
      id: tenantId,
      name: body.name,
      slug: body.slug,
      domain,
      parentId: body.parentId,
      createdAt: now,
      updatedAt: now,
    });

    const roleIds: Record<string, string> = {};
    for (const roleName of SYSTEM_ROLES) {
      const roleId = generateId("role");
      roleIds[roleName] = roleId;
      await tx.insert(role).values({
        id: roleId,
        tenantId,
        name: roleName,
        description: `System ${roleName} role`,
        isSystem: true,
        createdAt: now,
        updatedAt: now,
      });
    }

    const ownerRoleId = roleIds["owner"];
    if (!ownerRoleId) {
      throw new Error("Owner role was not created");
    }

    const ownerPrincipal = await principalStore.create(
      {
        id: generateId("principal"),
        tenantId,
        kind: "user",
        refId: userId,
        status: "active",
        createdAt: now,
        updatedAt: now,
      },
      tx,
    );

    await tx.insert(principalRole).values({
      principalId: ownerPrincipal.id,
      roleId: ownerRoleId,
      createdAt: now,
    });

    await tx.insert(grant).values({
      id: generateId("grant"),
      tenantId,
      roleId: ownerRoleId,
      resource: "*",
      action: "*",
      effect: "allow",
      origin: "system",
      createdAt: now,
      updatedAt: now,
    });

    return { id: tenantId, principalId: ownerPrincipal.id };
  });
}

async function resolveOrCreateWorkspaceTenant(
  db: DB["db"],
  principalKeyStore: PrincipalKeyStore,
  requestedTenantId?: string,
): Promise<ResolvedWorkspaceTenant> {
  if (requestedTenantId) {
    const [matched] = await db
      .select({
        tenantId: tenant.id,
        principalId: principal.id,
        userId: principal.refId,
      })
      .from(tenant)
      .innerJoin(
        principal,
        and(
          eq(principal.tenantId, tenant.id),
          eq(principal.kind, "user"),
          eq(principal.status, "active"),
        ),
      )
      .where(eq(tenant.id, requestedTenantId))
      .orderBy(asc(principal.createdAt))
      .limit(1);
    if (!matched) {
      throw new Error(
        `No active user principal found in tenant ${requestedTenantId}`,
      );
    }
    return matched;
  }

  const [rootRow] = await db
    .select({ id: tenant.id })
    .from(tenant)
    .where(eq(tenant.slug, INSTALL_ROOT_SLUG))
    .limit(1);

  const workspaceScope = rootRow
    ? or(
        eq(tenant.parentId, rootRow.id),
        and(isNull(tenant.parentId), ne(tenant.id, rootRow.id)),
      )
    : isNull(tenant.parentId);

  const [existingWorkspace] = await db
    .select({
      tenantId: tenant.id,
      principalId: principal.id,
      userId: principal.refId,
    })
    .from(tenant)
    .innerJoin(
      principal,
      and(
        eq(principal.tenantId, tenant.id),
        eq(principal.kind, "user"),
        eq(principal.status, "active"),
      ),
    )
    .where(and(ne(tenant.slug, INSTALL_ROOT_SLUG), workspaceScope))
    .orderBy(asc(tenant.createdAt), asc(principal.createdAt))
    .limit(1);

  if (existingWorkspace) {
    return existingWorkspace;
  }

  const [anyUserTenant] = await db
    .select({
      tenantId: tenant.id,
      principalId: principal.id,
      userId: principal.refId,
    })
    .from(tenant)
    .innerJoin(
      principal,
      and(
        eq(principal.tenantId, tenant.id),
        eq(principal.kind, "user"),
        eq(principal.status, "active"),
      ),
    )
    .where(ne(tenant.slug, INSTALL_ROOT_SLUG))
    .orderBy(asc(tenant.createdAt), asc(principal.createdAt))
    .limit(1);

  if (anyUserTenant) {
    return anyUserTenant;
  }

  const [existingUser] = await db
    .select({ id: user.id })
    .from(user)
    .orderBy(asc(user.createdAt))
    .limit(1);

  const userId = existingUser?.id ?? crypto.randomUUID();
  if (!existingUser) {
    await db.insert(user).values({
      id: userId,
      email: DEFAULT_DEV_USER.email,
      name: DEFAULT_DEV_USER.name,
      emailVerified: true,
    });
  }

  const created = await provisionChildTenant(db, principalKeyStore, userId, {
    name: DEFAULT_DEV_USER.workspaceName,
    slug: `${DEFAULT_DEV_USER.workspaceSlug}-${crypto.randomUUID().slice(0, 8)}`,
    parentId: rootRow?.id ?? null,
  });

  return {
    tenantId: created.id,
    principalId: created.principalId,
    userId,
  };
}

export function createDatabaseSeedDeps(
  db: DB["db"],
  principalKeyStore: PrincipalKeyStore,
): SeedDeps {
  if (!(db instanceof PostgresJsDatabase)) {
    throw new Error("Artifacts require postgres-js");
  }
  const artifactDb: ArtifactDb = db;

  return {
    async resolveWorkspaceTenant(tenantId?: string) {
      return resolveOrCreateWorkspaceTenant(db, principalKeyStore, tenantId);
    },

    async seedWorkspaceReviewers(workspace, reviewers) {
      await db
        .insert(settingsTable)
        .values({
          tenantId: workspace.tenantId,
          scopeKey: "workspace:reviewers",
          fields: {
            providerNames: { value: null, version: 0 },
            title: { value: null, version: 0 },
            reviewers,
          },
        })
        .onConflictDoNothing();
    },

    async createProject(workspace, input) {
      const projectId = crypto.randomUUID();
      const child = await provisionChildTenant(
        db,
        principalKeyStore,
        workspace.userId,
        {
          name: input.title,
          slug: `seed-${input.fixtureId}-${projectId.slice(0, 8)}`,
          parentId: workspace.tenantId,
        },
      );
      const now = new Date();
      await db.transaction(async (tx) => {
        await tx.insert(projectTable).values({
          id: projectId,
          tenantId: child.id,
          title: input.title,
          status: "active",
          createdAt: now,
          updatedAt: now,
        });
        await tx.insert(outboxTable).values({
          id: crypto.randomUUID(),
          projectId,
          eventType: "project.created",
          payload: {
            projectId,
            tenantId: child.id,
            title: input.title,
            problemStatement: input.problemStatement,
          },
          occurredAt: now,
        });
      });
      return {
        projectId,
        actor: {
          tenantId: child.id,
          principalId: child.principalId,
        },
      };
    },

    async writeArtifact(actor, _projectId, input) {
      if (input.kind === "design_option" || input.kind === "design") {
        DesignBundle.assert(JSON.parse(input.content));
      } else if (input.kind === "app") {
        AppBundle.assert(JSON.parse(input.content));
      } else if (input.kind === "approval_package") {
        ApprovalPackageBundle.assert(JSON.parse(input.content));
      } else {
        DocumentWrite.assert(input);
      }

      const metadata = {
        ...(input.openQuestions ? { openQuestions: input.openQuestions } : {}),
        ...(input.approaches ? { approaches: input.approaches } : {}),
      };
      const origin =
        input.kind === "design_option" ||
        input.kind === "app" ||
        input.kind === "approval_package"
          ? "workflow"
          : "user";

      const created = await artifactDb.transaction((tx) =>
        createArtifact(tx, {
          scope: actor,
          ownerPrincipalId: actor.principalId,
          kind: input.kind,
          title: input.title,
          content: input.content,
          ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
          source: { origin },
        }),
      );
      return {
        artifactId: created.id,
        kind: created.kind,
        version: created.version,
        sha256: created.contentSha256!,
      };
    },

    async recordArtifactApproval(actor, projectId, ref) {
      await db
        .insert(artifactImportApprovalTable)
        .values({
          artifactId: ref.artifactId,
          version: ref.version,
          tenantId: actor.tenantId,
          projectId,
          principalId: actor.principalId,
          kind: ref.kind,
          sha256: ref.sha256,
        })
        .onConflictDoNothing();
    },

    async chooseDesign(actor, projectId, input) {
      const option = await getArtifactVersion(
        artifactDb,
        input.artifactId,
        input.version,
      );
      if (!option || option.content === null) {
        throw new Error(`Design option ${input.artifactId} not found`);
      }
      const created = await artifactDb.transaction((tx) =>
        createArtifact(tx, {
          scope: actor,
          ownerPrincipalId: actor.principalId,
          kind: "design",
          title: option.title,
          content: option.content,
          source: { origin: "user" },
        }),
      );
      const designRef: ArtifactRef = {
        artifactId: created.id,
        kind: created.kind,
        version: created.version,
        sha256: created.contentSha256!,
      };
      await db
        .insert(artifactImportApprovalTable)
        .values({
          artifactId: designRef.artifactId,
          version: designRef.version,
          tenantId: actor.tenantId,
          projectId,
          principalId: actor.principalId,
          kind: designRef.kind,
          sha256: designRef.sha256,
        })
        .onConflictDoNothing();
      return {
        concept: option.title,
        design: designRef,
      };
    },

    async seedApprovalRound(actor, projectId, input) {
      const roundId = crypto.randomUUID();
      const now = new Date();
      const expiresAt = new Date(now.getTime() + EXPIRY_MS[input.round.expiry]);
      const triage = input.round.triage.map((item) => ({
        ...item,
        roundId,
      }));
      await db.insert(approvalRoundTable).values({
        id: roundId,
        tenantId: actor.tenantId,
        projectId,
        artifactId: input.artifactId,
        packageVersion: input.packageVersion,
        packageSha256: input.packageSha256,
        startedBy: actor.principalId,
        expiryPreset: input.round.expiry,
        expiresAt,
        settledAt: null,
        reviewers: input.round.reviewers,
        triage,
        createdAt: now,
      });
      return ApprovalRound.assert({
        roundId,
        projectId,
        artifactId: input.artifactId,
        packageVersion: input.packageVersion,
        packageSha256: input.packageSha256,
        expiry: input.round.expiry,
        status: "open",
        createdAt: now.toISOString(),
        expiresAt: expiresAt.toISOString(),
        reviewers: input.round.reviewers.map((reviewer) => ({
          id: reviewer.id,
          name: reviewer.name,
          persona: reviewer.persona,
          ...(reviewer.email === undefined ? {} : { email: reviewer.email }),
          ...(reviewer.goal === undefined ? {} : { goal: reviewer.goal }),
          state: reviewer.decision === undefined ? "sent" : "decided",
          ...(reviewer.decision === undefined
            ? {}
            : { decision: reviewer.decision }),
        })),
        triage,
      });
    },

    async shipProject(_actor, projectId) {
      const now = new Date();
      await db
        .update(projectTable)
        .set({ shippedAt: now, updatedAt: now })
        .where(eq(projectTable.id, projectId));
      return {
        ok: true,
        projectId,
        shippedAt: now.toISOString(),
      };
    },

    async listArtifacts(actor, projectId) {
      const page = await listArtifacts(artifactDb, actor.tenantId, {
        limit: MAX_LIST_LIMIT,
      });
      const approvals = await db
        .select({
          artifactId: artifactImportApprovalTable.artifactId,
          version: artifactImportApprovalTable.version,
        })
        .from(artifactImportApprovalTable)
        .where(
          and(
            eq(artifactImportApprovalTable.tenantId, actor.tenantId),
            eq(artifactImportApprovalTable.projectId, projectId),
          ),
        );
      const approvedByArtifact = new Map<string, number>();
      for (const row of approvals) {
        const prev = approvedByArtifact.get(row.artifactId);
        if (prev === undefined || row.version > prev) {
          approvedByArtifact.set(row.artifactId, row.version);
        }
      }

      const items: ArtifactListItem[] = [];
      const awaitingApproval: string[] = [];
      for (const item of page.rows) {
        const approvedVersion = approvedByArtifact.get(item.id);
        items.push({
          artifactId: item.id,
          kind: item.kind,
          title: item.title,
          version: item.version,
          sha256: item.contentSha256!,
          filedAt: item.updatedAt.toISOString(),
          ...(approvedVersion !== undefined ? { approvedVersion } : {}),
        });
        if (
          approvedVersion !== item.version &&
          item.kind !== "design_option" &&
          item.kind !== "design" &&
          item.kind !== "app" &&
          item.kind !== "approval_package"
        ) {
          awaitingApproval.push(item.kind);
        }
      }

      return {
        artifacts: items,
        inFlight: [],
        failed: [],
        awaitingApproval,
        appBuilt: await appBuilt(artifactDb, actor.tenantId),
        preferences: {},
        preferenceGuidance: [],
      };
    },
  };
}

export interface ParsedSeedCliArgs {
  help: boolean;
  options: SeedDevelopmentProjectsOptions;
}

const VALID_FIXTURE_SELECTORS = new Set<string>([...SEED_FIXTURE_IDS, "all"]);
const VALID_SEED_STAGES = new Set<string>(SEED_STAGES);

export function seedUsageText(): string {
  return [
    "Usage: bun run dev:seed [options]",
    "",
    "Seeds dummy Builder projects across lifecycle stages for local development.",
    "",
    "Options:",
    "  --fixture=<id|all>       Fixture to seed: habit-tracker | field-service-dispatch | clinical-trial-intake | all (default: all)",
    "  --stage=<stage>          Target stage: idea | brief | planning | design_options | designed | ready_to_build | shipped (default: each fixture's defaultStage)",
    "  --approve / --no-approve Approve documents at the target stage (default: --approve; upstream prerequisites are always approved)",
    "  --tenant=<tenantId>      Target workspace tenant ID (alias: --tenant-id=<tenantId>; defaults to first workspace tenant)",
    "  --help, -h               Show this help message",
  ].join("\n");
}

export function parseSeedCliArgs(argv: readonly string[]): ParsedSeedCliArgs {
  const options: SeedDevelopmentProjectsOptions = {
    fixture: "all",
    approve: true,
  };
  let help = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === "--help" || arg === "-h") {
      help = true;
      continue;
    }
    if (arg === "--approve") {
      options.approve = true;
      continue;
    }
    if (arg === "--no-approve") {
      options.approve = false;
      continue;
    }
    if (arg.startsWith("--approve=")) {
      const value = arg.slice("--approve=".length);
      if (value !== "true" && value !== "false") {
        throw new Error(`Invalid --approve value: ${value}`);
      }
      options.approve = value === "true";
      continue;
    }
    if (arg === "--fixture" || arg.startsWith("--fixture=")) {
      const value =
        arg === "--fixture" ? argv[++index] : arg.slice("--fixture=".length);
      if (!value || !VALID_FIXTURE_SELECTORS.has(value)) {
        throw new Error(
          `Invalid --fixture value "${String(value)}". Expected one of: ${[...VALID_FIXTURE_SELECTORS].join(", ")}`,
        );
      }
      options.fixture = value as SeedFixtureSelector;
      continue;
    }
    if (arg === "--stage" || arg.startsWith("--stage=")) {
      const value =
        arg === "--stage" ? argv[++index] : arg.slice("--stage=".length);
      if (!value || !VALID_SEED_STAGES.has(value)) {
        throw new Error(
          `Invalid --stage value "${String(value)}". Expected one of: ${SEED_STAGES.join(", ")}`,
        );
      }
      options.stage = value as SeedStage;
      continue;
    }
    if (
      arg === "--tenant" ||
      arg === "--tenant-id" ||
      arg.startsWith("--tenant=") ||
      arg.startsWith("--tenant-id=")
    ) {
      let value: string | undefined;
      if (arg === "--tenant" || arg === "--tenant-id") {
        value = argv[++index];
      } else if (arg.startsWith("--tenant=")) {
        value = arg.slice("--tenant=".length);
      } else {
        value = arg.slice("--tenant-id=".length);
      }
      if (!value) {
        throw new Error("Missing tenant ID for --tenant / --tenant-id");
      }
      options.tenantId = value;
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }

  return { help, options };
}

export async function runDevelopmentSeed(
  rawEnvironment: Record<string, string | undefined> = process.env,
  options: SeedDevelopmentProjectsOptions = {},
): Promise<SeedDevelopmentProjectsResult> {
  const env = readHubEnvironment(rawEnvironment);
  await migrateDatabase(rawEnvironment);
  const handle = createDB(env.database);
  try {
    const principalKeyStore = createPrincipalKeyStore({
      db: handle.db,
      cipher: createEnvKeyCredentialCipher(hexDecode(env.principalKey)),
    });
    const deps = createDatabaseSeedDeps(handle.db, principalKeyStore);
    return await seedDevelopmentProjects(deps, options);
  } finally {
    await handle.close();
  }
}

export async function main(argv: readonly string[] = process.argv.slice(2)) {
  const parsed = parseSeedCliArgs(argv);
  if (parsed.help) {
    console.log(seedUsageText());
    return;
  }

  const result = await runDevelopmentSeed(process.env, parsed.options);
  console.log(
    JSON.stringify(
      {
        seeded: true,
        workspaceTenantId: result.workspaceTenantId,
        stage: result.stage,
        approve: result.approve,
        projects: result.projects.map((project) => ({
          fixtureId: project.fixtureId,
          complexity: project.complexity,
          projectId: project.projectId,
          projectTenantId: project.projectTenantId,
          title: project.title,
          stage: project.stage,
          shippedAt: project.shippedAt,
          artifactKinds: project.artifacts.map((item) => item.kind),
          awaitingApproval: project.awaitingApproval,
          approvalRoundId: project.approvalRound?.roundId ?? null,
        })),
      },
      null,
      2,
    ),
  );
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(JSON.stringify({ seeded: false, error: message }));
    process.exitCode = 1;
  }
}
