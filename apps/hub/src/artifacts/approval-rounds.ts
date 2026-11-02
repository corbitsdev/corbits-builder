import { type } from "arktype";
import { and, desc, eq } from "drizzle-orm";
import { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type { Hono } from "hono";
import { describeRoute, resolver } from "hono-openapi";
import {
  contentDispositionHeader,
  getArtifactVersion,
  listArtifacts,
  listArtifactVersions,
  MAX_LIST_LIMIT,
  type ArtifactDb,
} from "@corbits/artifacts";
import { zip, type ZipEntry } from "@corbits/zip";
import type { DB } from "@intx/db";
import type { TenantEnv } from "@intx/hub-api";
import { principal } from "@intx/db/schema";
import { base64Decode } from "@intx/types";
import type { ApprovalPackageBundle } from "@corbits-builder/schemas/artifact";
import {
  ApprovalRound,
  ApprovalRoundList,
  RecordReviewerDecision,
  StartApprovalRound,
  type ApprovalReviewer,
  type ApprovalRoundStatus,
  type ExpiryPreset,
  type ReviewerDecision,
} from "@corbits-builder/schemas/approval-round";
import {
  approvalRound,
  artifactImportApproval,
  project,
} from "../db/schema.ts";
import {
  packageReadme,
  type PackageManifestSource,
} from "../config/approval-rounds.ts";
import type { Actor } from "../lib/actor.ts";
import { readJson } from "../lib/json.ts";
import { actorOf, authorizeProject } from "../projects/authorization.ts";
import { ProjectError } from "../projects/errors.ts";
import { parseApprovalPackageBundle } from "./approval-package.ts";

export const APPROVAL_PACKAGE_KIND = "approval_package";

const EXPIRY_MS: Readonly<Record<ExpiryPreset, number>> = {
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
};

export type StoredReviewer = {
  id: string;
  name: string;
  persona: string;
  email?: string;
  decision?: ReviewerDecision;
};

export type StoredApprovalRound = {
  roundId: string;
  tenantId: string;
  projectId: string;
  artifactId: string;
  packageVersion: number;
  packageSha256: string;
  startedBy: string;
  expiry: ExpiryPreset;
  createdAt: Date;
  expiresAt: Date;
  settledAt: Date | null;
  reviewers: StoredReviewer[];
  triggeredRunId: string | null;
};

export type StoredPackageDocument = {
  kind: string;
  title: string;
  version: number;
  sha256: string;
  content: string;
};

export type StoredPackageVersion = {
  projectTitle: string;
  artifactId: string;
  version: number;
  latestVersion: number;
  sha256: string;
  title: string;
  content: string;
  projectDocuments: StoredPackageDocument[];
};

export type ApprovalRoundStore = {
  authorize(
    actor: Actor,
    projectId: string,
    action: "read" | "manage",
    requirePerson?: boolean,
  ): Promise<void>;
  readPackage(
    actor: Actor,
    projectId: string,
    version: number,
  ): Promise<StoredPackageVersion>;
  recordPackageApproval(
    actor: Actor,
    projectId: string,
    ref: { artifactId: string; version: number; sha256: string },
  ): Promise<void>;
  insertRound(round: StoredApprovalRound): Promise<void>;
  listRounds(
    tenantId: string,
    projectId: string,
  ): Promise<StoredApprovalRound[]>;
  readRound(
    tenantId: string,
    projectId: string,
    roundId: string,
  ): Promise<StoredApprovalRound | undefined>;
  updateRound(round: StoredApprovalRound): Promise<void>;
  triggerFeedbackRun?(
    actor: Actor,
    projectId: string,
    round: StoredApprovalRound,
    reviewerId: string,
  ): Promise<string | undefined>;
  now?(): Date;
};

function sanitizeArchiveStem(title: string): string {
  const cleaned = title
    .replace(/[\\/:*?"<>|\s]+/g, "-")
    .replace(/\.{2,}/g, "-")
    .replace(/^[.-]+/, "");
  return cleaned === "" ? "package" : cleaned;
}

function isSafeRelativePath(path: string): boolean {
  return (
    path !== "" &&
    !path.startsWith("/") &&
    !path.includes("\\") &&
    !path.split("/").includes("..")
  );
}

function decodeBinaryField(value: string): Uint8Array<ArrayBuffer> {
  const dataUrlMatch = /^data:[^;,]*;base64,(.*)$/s.exec(value);
  const encoded = dataUrlMatch === null ? value : (dataUrlMatch[1] as string);
  const decoded = base64Decode(encoded);
  const copy = new Uint8Array(new ArrayBuffer(decoded.byteLength));
  copy.set(decoded);
  return copy;
}

function extractSupportingDocuments(
  bundle: ApprovalPackageBundle,
  projectDocuments: readonly StoredPackageDocument[],
): ZipEntry[] {
  const docMap = new Map<string, string>();
  if (bundle.documents !== undefined) {
    for (const [key, value] of Object.entries(bundle.documents)) {
      if (key === "app") continue;
      const normalized = key.endsWith(".md") ? key : `${key}.md`;
      const path = normalized.startsWith("documents/")
        ? normalized
        : `documents/${normalized}`;
      if (isSafeRelativePath(path)) docMap.set(path, value);
    }
  }
  for (const source of bundle.manifest.sources) {
    if (source.kind === "app" || source.kind === APPROVAL_PACKAGE_KIND)
      continue;
    const path = `documents/${source.kind}.md`;
    if (docMap.has(path) || !isSafeRelativePath(path)) continue;
    const match = projectDocuments.find(
      (doc) =>
        doc.kind === source.kind &&
        doc.version === source.version &&
        doc.sha256 === source.sha256,
    );
    if (match !== undefined) docMap.set(path, match.content);
  }
  return [...docMap.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([path, data]) => ({ path, data }));
}

async function buildPackageArchive(
  pkg: StoredPackageVersion,
): Promise<{ filename: string; archive: Uint8Array<ArrayBuffer> }> {
  const bundle = parseApprovalPackageBundle(pkg.content);
  const pptx = decodeBinaryField(bundle.pptxBase64);
  const pdf = decodeBinaryField(bundle.pdfBase64);
  const sources: PackageManifestSource[] = bundle.manifest.sources;
  const docEntries = extractSupportingDocuments(bundle, pkg.projectDocuments);
  const readme = packageReadme({
    projectTitle: pkg.projectTitle,
    packageTitle: pkg.title,
    version: pkg.version,
    audience: bundle.manifest.audience,
    decision: bundle.manifest.decisionNeeded,
    sources,
    documents: docEntries.map((entry) => entry.path),
  });
  const manifestPayload = {
    version: pkg.version,
    sha256: pkg.sha256,
    ...bundle.manifest,
  };
  const entries: ZipEntry[] = [
    { path: "README.md", data: readme },
    { path: "manifest.json", data: JSON.stringify(manifestPayload, null, 2) },
    { path: "deck.pptx", data: pptx },
    { path: "deck.pdf", data: pdf },
    ...docEntries,
  ];
  const stem = sanitizeArchiveStem(pkg.projectTitle);
  return {
    filename: `${stem}-package-v${String(pkg.version)}.zip`,
    archive: await zip(entries),
  };
}

function deriveRoundStatus(
  round: StoredApprovalRound,
  now: Date,
): ApprovalRoundStatus {
  if (round.settledAt !== null) return "settled";
  if (now.getTime() >= round.expiresAt.getTime()) return "expired";
  return "open";
}

function deriveReviewerState(
  reviewer: StoredReviewer,
  expired: boolean,
): ApprovalReviewer["state"] {
  if (reviewer.decision !== undefined) return "decided";
  if (expired) return "expired";
  return "sent";
}

function deriveReviewerView(
  reviewer: StoredReviewer,
  expired: boolean,
): ApprovalReviewer {
  return {
    id: reviewer.id,
    name: reviewer.name,
    persona: reviewer.persona,
    ...(reviewer.email === undefined ? {} : { email: reviewer.email }),
    state: deriveReviewerState(reviewer, expired),
    ...(reviewer.decision === undefined ? {} : { decision: reviewer.decision }),
  };
}

function serializeRound(round: StoredApprovalRound, now: Date): ApprovalRound {
  const status = deriveRoundStatus(round, now);
  const expired = now.getTime() >= round.expiresAt.getTime();
  return ApprovalRound.assert({
    roundId: round.roundId,
    projectId: round.projectId,
    artifactId: round.artifactId,
    packageVersion: round.packageVersion,
    packageSha256: round.packageSha256,
    expiry: round.expiry,
    status,
    createdAt: round.createdAt.toISOString(),
    expiresAt: round.expiresAt.toISOString(),
    ...(round.settledAt === null
      ? {}
      : { settledAt: round.settledAt.toISOString() }),
    reviewers: round.reviewers.map((reviewer) =>
      deriveReviewerView(reviewer, expired),
    ),
    ...(round.triggeredRunId === null
      ? {}
      : { triggeredRunId: round.triggeredRunId }),
  });
}

function hasFeedbackContent(decision: ReviewerDecision): boolean {
  if (decision.outcome === "request_changes" || decision.outcome === "comment")
    return true;
  if (decision.note !== undefined && decision.note.trim() !== "") return true;
  return decision.slideNotes.length > 0;
}

export function createPgApprovalRoundStore(
  rawDB: DB["db"],
  triggerFeedbackRun?: ApprovalRoundStore["triggerFeedbackRun"],
): ApprovalRoundStore {
  if (!(rawDB instanceof PostgresJsDatabase)) {
    throw new Error("Approval rounds require postgres-js");
  }
  const db: ArtifactDb = rawDB;
  return {
    async authorize(actor, projectId, action, requirePerson = false) {
      await authorizeProject(rawDB, actor, projectId, action);
      if (!requirePerson) return;
      const [caller] = await rawDB
        .select({ kind: principal.kind })
        .from(principal)
        .where(eq(principal.id, actor.principalId));
      if (caller?.kind !== "user") {
        throw new ProjectError(403, "approval_round_person_only");
      }
    },

    async readPackage(actor, projectId, version) {
      const [projectRow] = await rawDB
        .select({ title: project.title })
        .from(project)
        .where(eq(project.id, projectId));
      if (!projectRow) throw new ProjectError(404, "project_not_found");
      const [pkg] = (
        await listArtifacts(db, actor.tenantId, {
          kind: APPROVAL_PACKAGE_KIND,
          limit: 1,
        })
      ).rows;
      if (!pkg) {
        throw new ProjectError(404, "package_not_found", { version });
      }
      const [newest] = (await listArtifactVersions(db, pkg.id, { limit: 1 }))
        .versions;
      const stored = await getArtifactVersion(db, pkg.id, version);
      if (!stored?.contentSha256 || !newest) {
        throw new ProjectError(404, "package_not_found", { version });
      }
      const { rows } = await listArtifacts(db, actor.tenantId, {
        limit: MAX_LIST_LIMIT,
      });
      const projectDocuments: StoredPackageDocument[] = [];
      for (const row of rows) {
        if (
          !row.contentSha256 ||
          row.kind === "app" ||
          row.kind === APPROVAL_PACKAGE_KIND
        ) {
          continue;
        }
        const docVersion = await getArtifactVersion(db, row.id, row.version);
        if (docVersion?.contentSha256) {
          projectDocuments.push({
            kind: row.kind,
            title: docVersion.title,
            version: docVersion.version,
            sha256: docVersion.contentSha256,
            content: docVersion.content,
          });
        }
      }
      return {
        projectTitle: projectRow.title,
        artifactId: pkg.id,
        version: stored.version,
        latestVersion: newest.version,
        sha256: stored.contentSha256,
        title: stored.title,
        content: stored.content,
        projectDocuments,
      };
    },

    async recordPackageApproval(actor, projectId, ref) {
      await rawDB
        .insert(artifactImportApproval)
        .values({
          artifactId: ref.artifactId,
          version: ref.version,
          sha256: ref.sha256,
          kind: APPROVAL_PACKAGE_KIND,
          tenantId: actor.tenantId,
          projectId,
          principalId: actor.principalId,
        })
        .onConflictDoNothing();
    },

    async insertRound(round) {
      await rawDB.insert(approvalRound).values({
        id: round.roundId,
        tenantId: round.tenantId,
        projectId: round.projectId,
        artifactId: round.artifactId,
        packageVersion: round.packageVersion,
        packageSha256: round.packageSha256,
        startedBy: round.startedBy,
        expiryPreset: round.expiry,
        expiresAt: round.expiresAt,
        settledAt: round.settledAt,
        reviewers: round.reviewers,
        triggeredRunId: round.triggeredRunId,
        createdAt: round.createdAt,
      });
    },

    async listRounds(tenantId, projectId) {
      const rows = await rawDB
        .select()
        .from(approvalRound)
        .where(
          and(
            eq(approvalRound.tenantId, tenantId),
            eq(approvalRound.projectId, projectId),
          ),
        )
        .orderBy(desc(approvalRound.createdAt));
      return rows.map((row) => ({
        roundId: row.id,
        tenantId: row.tenantId,
        projectId: row.projectId,
        artifactId: row.artifactId,
        packageVersion: row.packageVersion,
        packageSha256: row.packageSha256,
        startedBy: row.startedBy,
        expiry: row.expiryPreset as ExpiryPreset,
        createdAt: row.createdAt,
        expiresAt: row.expiresAt,
        settledAt: row.settledAt,
        reviewers: row.reviewers as StoredReviewer[],
        triggeredRunId: row.triggeredRunId,
      }));
    },

    async readRound(tenantId, projectId, roundId) {
      const [row] = await rawDB
        .select()
        .from(approvalRound)
        .where(
          and(
            eq(approvalRound.id, roundId),
            eq(approvalRound.tenantId, tenantId),
            eq(approvalRound.projectId, projectId),
          ),
        );
      if (!row) return undefined;
      return {
        roundId: row.id,
        tenantId: row.tenantId,
        projectId: row.projectId,
        artifactId: row.artifactId,
        packageVersion: row.packageVersion,
        packageSha256: row.packageSha256,
        startedBy: row.startedBy,
        expiry: row.expiryPreset as ExpiryPreset,
        createdAt: row.createdAt,
        expiresAt: row.expiresAt,
        settledAt: row.settledAt,
        reviewers: row.reviewers as StoredReviewer[],
        triggeredRunId: row.triggeredRunId,
      };
    },

    async updateRound(round) {
      await rawDB
        .update(approvalRound)
        .set({
          settledAt: round.settledAt,
          reviewers: round.reviewers,
          triggeredRunId: round.triggeredRunId,
        })
        .where(
          and(
            eq(approvalRound.id, round.roundId),
            eq(approvalRound.tenantId, round.tenantId),
            eq(approvalRound.projectId, round.projectId),
          ),
        );
    },

    ...(triggerFeedbackRun === undefined ? {} : { triggerFeedbackRun }),
  };
}

export function createApprovalRoundService(store: ApprovalRoundStore) {
  const currentNow = () => (store.now === undefined ? new Date() : store.now());

  return {
    async packageZip(actor: Actor, projectId: string, version: number) {
      await store.authorize(actor, projectId, "read");
      const pkg = await store.readPackage(actor, projectId, version);
      return buildPackageArchive(pkg);
    },

    async list(actor: Actor, projectId: string): Promise<ApprovalRoundList> {
      await store.authorize(actor, projectId, "read");
      const now = currentNow();
      const rows = await store.listRounds(actor.tenantId, projectId);
      return {
        rounds: rows.map((row) => serializeRound(row, now)),
      };
    },

    async start(
      actor: Actor,
      projectId: string,
      raw: unknown,
    ): Promise<ApprovalRound> {
      const input = StartApprovalRound(raw);
      if (input instanceof type.errors) {
        throw new ProjectError(400, "invalid_approval_round", {
          issues: input.summary,
        });
      }
      await store.authorize(actor, projectId, "manage", true);
      const pkg = await store.readPackage(
        actor,
        projectId,
        input.packageVersion,
      );
      if (pkg.latestVersion !== pkg.version) {
        throw new ProjectError(409, "artifact_ref_stale", {
          artifactId: pkg.artifactId,
          version: input.packageVersion,
        });
      }
      await store.recordPackageApproval(actor, projectId, {
        artifactId: pkg.artifactId,
        version: pkg.version,
        sha256: pkg.sha256,
      });
      const now = currentNow();
      const expiresAt = new Date(now.getTime() + EXPIRY_MS[input.expiry]);
      const round: StoredApprovalRound = {
        roundId: crypto.randomUUID(),
        tenantId: actor.tenantId,
        projectId,
        artifactId: pkg.artifactId,
        packageVersion: pkg.version,
        packageSha256: pkg.sha256,
        startedBy: actor.principalId,
        expiry: input.expiry,
        createdAt: now,
        expiresAt,
        settledAt: null,
        reviewers: input.reviewers.map((reviewer) => ({
          id: crypto.randomUUID(),
          name: reviewer.name.trim(),
          persona: reviewer.persona.trim(),
          ...(reviewer.email === undefined
            ? {}
            : { email: reviewer.email.trim() }),
        })),
        triggeredRunId: null,
      };
      await store.insertRound(round);
      return serializeRound(round, now);
    },

    async recordDecision(
      actor: Actor,
      projectId: string,
      roundId: string,
      reviewerId: string,
      raw: unknown,
    ): Promise<ApprovalRound> {
      const input = RecordReviewerDecision(raw);
      if (input instanceof type.errors) {
        throw new ProjectError(400, "invalid_reviewer_decision", {
          issues: input.summary,
        });
      }
      await store.authorize(actor, projectId, "manage", true);
      const round = await store.readRound(actor.tenantId, projectId, roundId);
      if (!round) {
        throw new ProjectError(404, "approval_round_not_found", { roundId });
      }
      if (round.settledAt !== null) {
        throw new ProjectError(409, "approval_round_settled", { roundId });
      }
      const now = currentNow();
      if (now.getTime() >= round.expiresAt.getTime()) {
        throw new ProjectError(409, "approval_round_expired", { roundId });
      }
      const index = round.reviewers.findIndex(
        (reviewer) => reviewer.id === reviewerId,
      );
      if (index === -1) {
        throw new ProjectError(404, "approval_reviewer_not_found", {
          roundId,
          reviewerId,
        });
      }
      const trimmedNote = input.note === undefined ? "" : input.note.trim();
      const decision: ReviewerDecision = {
        outcome: input.outcome,
        ...(trimmedNote === "" ? {} : { note: trimmedNote }),
        slideNotes: input.slideNotes === undefined ? [] : input.slideNotes,
        decidedAt: now.toISOString(),
      };
      const target = round.reviewers[index]!;
      const updatedReviewers = [...round.reviewers];
      updatedReviewers[index] = {
        ...target,
        decision,
      };
      const updatedRound: StoredApprovalRound = {
        ...round,
        reviewers: updatedReviewers,
      };
      if (
        hasFeedbackContent(decision) &&
        store.triggerFeedbackRun !== undefined
      ) {
        const triggered = await store.triggerFeedbackRun(
          actor,
          projectId,
          updatedRound,
          reviewerId,
        );
        if (triggered !== undefined) {
          updatedRound.triggeredRunId = triggered;
        }
      }
      await store.updateRound(updatedRound);
      return serializeRound(updatedRound, now);
    },

    async settle(
      actor: Actor,
      projectId: string,
      roundId: string,
    ): Promise<ApprovalRound> {
      await store.authorize(actor, projectId, "manage", true);
      const round = await store.readRound(actor.tenantId, projectId, roundId);
      if (!round) {
        throw new ProjectError(404, "approval_round_not_found", { roundId });
      }
      const now = currentNow();
      if (round.settledAt !== null) {
        return serializeRound(round, now);
      }
      const expired = now.getTime() >= round.expiresAt.getTime();
      const allDecided = round.reviewers.every(
        (reviewer) => reviewer.decision !== undefined,
      );
      if (!expired && !allDecided) {
        throw new ProjectError(409, "round_reviewers_pending", { roundId });
      }
      const settledRound: StoredApprovalRound = {
        ...round,
        settledAt: now,
      };
      await store.updateRound(settledRound);
      return serializeRound(settledRound, now);
    },
  };
}

export type ApprovalRoundService = ReturnType<
  typeof createApprovalRoundService
>;

const security = [
  { sessionCookie: [] },
  { deviceBearer: [] },
  { coordinatorBearer: [] },
];

export function mountApprovalRoundRoutes(
  app: Hono<TenantEnv>,
  service: ApprovalRoundService,
) {
  const body = async (c: { req: { json(): Promise<unknown> } }) => {
    const json = await readJson(c.req);
    if (json === undefined) throw new ProjectError(400, "invalid_json");
    return json;
  };

  app.get(
    "/:projectId/packages/:version/zip",
    describeRoute({
      tags: ["Artifacts"],
      operationId: "downloadApprovalPackageZip",
      description:
        "Packs a filed approval_package version into a deterministic zip archive containing deck.pptx, deck.pdf, README.md, manifest.json, and any grounded supporting documents.",
      security,
      parameters: [
        {
          name: "version",
          in: "path",
          required: true,
          schema: { type: "integer", minimum: 1 },
        },
      ],
      responses: {
        200: {
          description: "The approval package zip archive",
          content: {
            "application/zip": { schema: { type: "string", format: "binary" } },
          },
        },
        400: { description: "Invalid package version" },
        404: { description: "Approval package version not found" },
      },
    }),
    async (c) => {
      const rawVersion = c.req.param("version");
      const version = Number(rawVersion);
      if (!Number.isInteger(version) || version < 1) {
        throw new ProjectError(400, "invalid_package_version", {
          version: rawVersion,
        });
      }
      const { filename, archive } = await service.packageZip(
        actorOf(c),
        c.req.param("projectId"),
        version,
      );
      return new Response(archive, {
        headers: {
          "content-type": "application/zip",
          "content-disposition": contentDispositionHeader(
            "attachment",
            filename,
          ),
        },
      });
    },
  );

  app.get(
    "/:projectId/approval-rounds",
    describeRoute({
      tags: ["Artifacts"],
      operationId: "listApprovalRounds",
      description:
        "Lists the project's approval rounds, newest first, with each reviewer's current state and recorded decision.",
      security,
      responses: {
        200: {
          description: "The project's approval rounds",
          content: {
            "application/json": { schema: resolver(ApprovalRoundList) },
          },
        },
      },
    }),
    async (c) => {
      return c.json(await service.list(actorOf(c), c.req.param("projectId")));
    },
  );

  app.post(
    "/:projectId/approval-rounds",
    describeRoute({
      tags: ["Artifacts"],
      operationId: "startApprovalRound",
      description:
        "Approves the exact approval_package version and SHA-256 as the calling person and opens a review round for the named reviewers.",
      security,
      requestBody: {
        required: true,
        content: {
          "application/json": { schema: resolver(StartApprovalRound) },
        },
      },
      responses: {
        200: {
          description: "The created approval round",
          content: {
            "application/json": { schema: resolver(ApprovalRound) },
          },
        },
        400: { description: "Invalid approval round input" },
        403: { description: "Caller is not a person who manages the project" },
        404: { description: "Approval package version not found" },
        409: { description: "Package has a newer version than the one shared" },
      },
    }),
    async (c) => {
      return c.json(
        await service.start(
          actorOf(c),
          c.req.param("projectId"),
          await body(c),
        ),
      );
    },
  );

  app.post(
    "/:projectId/approval-rounds/:roundId/reviewers/:reviewerId/decision",
    describeRoute({
      tags: ["Artifacts"],
      operationId: "recordReviewerDecision",
      description:
        "Records or amends a reviewer's decision (approve, request_changes, or comment) with optional overall note and per-slide notes while the round is open.",
      security,
      requestBody: {
        required: true,
        content: {
          "application/json": { schema: resolver(RecordReviewerDecision) },
        },
      },
      responses: {
        200: {
          description: "The updated approval round",
          content: {
            "application/json": { schema: resolver(ApprovalRound) },
          },
        },
        400: { description: "Invalid reviewer decision" },
        403: { description: "Caller is not a person who manages the project" },
        404: { description: "Round or reviewer not found" },
        409: { description: "Round is already expired or settled" },
      },
    }),
    async (c) => {
      return c.json(
        await service.recordDecision(
          actorOf(c),
          c.req.param("projectId"),
          c.req.param("roundId"),
          c.req.param("reviewerId"),
          await body(c),
        ),
      );
    },
  );

  app.post(
    "/:projectId/approval-rounds/:roundId/settle",
    describeRoute({
      tags: ["Artifacts"],
      operationId: "settleApprovalRound",
      description:
        "Marks the approval round settled once every reviewer has decided or the round has expired.",
      security,
      responses: {
        200: {
          description: "The settled approval round",
          content: {
            "application/json": { schema: resolver(ApprovalRound) },
          },
        },
        403: { description: "Caller is not a person who manages the project" },
        404: { description: "Round not found" },
        409: { description: "Reviewers are still pending on an open round" },
      },
    }),
    async (c) => {
      return c.json(
        await service.settle(
          actorOf(c),
          c.req.param("projectId"),
          c.req.param("roundId"),
        ),
      );
    },
  );
}
