import { type } from "arktype";
import { and, desc, eq } from "drizzle-orm";
import { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type { Hono } from "hono";
import { describeRoute, resolver } from "hono-openapi";
import {
  contentDispositionHeader,
  getArtifact,
  getArtifactVersion,
  listArtifacts,
  listArtifactVersions,
  type ArtifactDb,
} from "@corbits/artifacts";
import { zip, type ZipEntry } from "@corbits/zip";
import type { DB } from "@intx/db";
import type { TenantEnv } from "@intx/hub-api";
import { principal, tenant } from "@intx/db/schema";
import { base64Decode } from "@intx/types";
import {
  DesignBundle,
  type ApprovalPackageBundle,
} from "@corbits-builder/schemas/artifact";
import {
  ApprovalRound,
  ApprovalRoundList,
  RecordReviewerDecision,
  StartApprovalRound,
  TriageDecisionInput,
  type ApprovalReviewer,
  type ApprovalRoundStatus,
  type ExpiryPreset,
  type ReviewerDecision,
  type ReviewerInput,
  type TriageItem,
  type WorkspaceReviewer,
} from "@corbits-builder/schemas/approval-round";
import {
  approvalRound,
  artifactImportApproval,
  project,
  projectCoordinator,
  settingsRecord,
} from "../db/schema.ts";
import {
  incorporatedFeedbackMessage,
  packageReadme,
  type PackageManifestSource,
} from "../config/approval-rounds.ts";
import type { Actor } from "../lib/actor.ts";
import { parseJson, readJson } from "../lib/json.ts";
import { mailRunAsCaller } from "../mail/caller-mail.ts";
import { actorOf, authorizeProject } from "../projects/authorization.ts";
import { ProjectError } from "../projects/errors.ts";
import {
  EXCLUDED_PACKAGE_SOURCE_KINDS,
  parseApprovalPackageBundle,
} from "./approval-package.ts";

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
  goal?: string;
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
  triage: TriageItem[];
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
  transactRound?<T>(
    tenantId: string,
    projectId: string,
    roundId: string,
    fn: (
      round: StoredApprovalRound | undefined,
      save: (updated: StoredApprovalRound) => Promise<void>,
    ) => Promise<T>,
  ): Promise<T>;
  listWorkspaceReviewers?(tenantId: string): Promise<WorkspaceReviewer[]>;
  saveWorkspaceReviewers?(
    tenantId: string,
    reviewers: readonly ReviewerInput[],
  ): Promise<WorkspaceReviewer[]>;
  activeCoordinatorRunId?(projectId: string): Promise<string | undefined>;
  now?(): Date;
};

function sanitizeArchiveStem(title: string): string {
  const cleaned = title
    .replace(/[\p{Cc}\\/:*?"<>|\s]+/gu, "-")
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

function extractDocumentMarkdown(kind: string, content: string): string {
  const parsed = DesignBundle(parseJson(content));
  if (!(parsed instanceof type.errors)) {
    const markdown = parsed.files["DESIGN.md"];
    if (markdown !== undefined) return markdown;
  }
  if (kind === "design" || kind === "design_option") {
    const raw = parseJson(content);
    if (
      typeof raw === "object" &&
      raw !== null &&
      "files" in raw &&
      typeof raw.files === "object" &&
      raw.files !== null &&
      "DESIGN.md" in raw.files &&
      typeof raw.files["DESIGN.md"] === "string"
    ) {
      return raw.files["DESIGN.md"];
    }
  }
  return content;
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
      if (isSafeRelativePath(path)) {
        docMap.set(path, extractDocumentMarkdown(key, value));
      }
    }
  }
  for (const source of bundle.manifest.sources) {
    if (EXCLUDED_PACKAGE_SOURCE_KINDS.has(source.kind)) continue;
    const path = `documents/${source.kind}.md`;
    if (docMap.has(path) || !isSafeRelativePath(path)) continue;
    const matched = projectDocuments.find(
      (doc) =>
        doc.kind === source.kind &&
        doc.version === source.version &&
        doc.sha256 === source.sha256,
    );
    if (matched !== undefined) {
      docMap.set(path, extractDocumentMarkdown(source.kind, matched.content));
    }
  }
  return [...docMap.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([path, data]) => ({ path, data }));
}

export type PackageReviewerRecipient = {
  name: string;
  persona: string;
};

async function buildPackageArchive(
  pkg: StoredPackageVersion,
  reviewer?: PackageReviewerRecipient,
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
    ...(reviewer === undefined ? {} : { reviewer }),
    audience: bundle.manifest.audience,
    decision: bundle.manifest.decisionNeeded,
    sources,
    documents: docEntries.map((entry) => entry.path),
  });
  const manifestPayload = {
    version: pkg.version,
    sha256: pkg.sha256,
    ...(reviewer === undefined
      ? {}
      : { reviewer: { name: reviewer.name, persona: reviewer.persona } }),
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
  const filename =
    reviewer === undefined || reviewer.name.trim() === ""
      ? `${stem}-package-v${String(pkg.version)}.zip`
      : `${stem.toLowerCase()}-approval-package-for-${sanitizeArchiveStem(reviewer.name).toLowerCase()}-${sanitizeArchiveStem(reviewer.persona).toLowerCase()}.zip`;
  return {
    filename,
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
    ...(reviewer.goal === undefined ? {} : { goal: reviewer.goal }),
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
    triage: round.triage,
  });
}

function splitNoteBullets(rawText: string): string[] {
  return rawText
    .split(/\r?\n/)
    .map((line) =>
      line
        .replace(/^[-*•+]\s+/, "")
        .replace(/^\d+[.)]\s+/, "")
        .trim(),
    )
    .filter((line) => line !== "" && !line.startsWith("#"))
    .slice(0, 100);
}

function extractTriageItemsForDecision(
  roundId: string,
  reviewer: StoredReviewer,
  decision: ReviewerDecision,
): TriageItem[] {
  const items: TriageItem[] = [];
  if (decision.note !== undefined) {
    for (const text of splitNoteBullets(decision.note)) {
      items.push({
        itemId: crypto.randomUUID(),
        roundId,
        reviewerId: reviewer.id,
        reviewerName: reviewer.name,
        persona: reviewer.persona,
        text,
        status: "pending",
      });
    }
  }
  for (const slideNote of decision.slideNotes) {
    for (const text of splitNoteBullets(slideNote.text)) {
      items.push({
        itemId: crypto.randomUUID(),
        roundId,
        reviewerId: reviewer.id,
        reviewerName: reviewer.name,
        persona: reviewer.persona,
        slide: slideNote.slide,
        text,
        status: "pending",
      });
    }
  }
  return items;
}

const WORKSPACE_REVIEWERS_SCOPE_KEY = "workspace:reviewers";

function parseWorkspaceReviewersField(
  raw: unknown,
): WorkspaceReviewer[] | null {
  if (typeof raw !== "object" || raw === null || !("reviewers" in raw)) {
    return null;
  }
  const list = raw.reviewers;
  if (!Array.isArray(list)) return null;
  const parsed: WorkspaceReviewer[] = [];
  for (const entry of list) {
    if (
      typeof entry === "object" &&
      entry !== null &&
      "id" in entry &&
      typeof entry.id === "string" &&
      "name" in entry &&
      typeof entry.name === "string" &&
      "persona" in entry &&
      typeof entry.persona === "string"
    ) {
      const email =
        "email" in entry &&
        typeof entry.email === "string" &&
        entry.email.trim() !== ""
          ? entry.email.trim()
          : undefined;
      const goal =
        "goal" in entry &&
        typeof entry.goal === "string" &&
        entry.goal.trim() !== ""
          ? entry.goal.trim()
          : undefined;
      parsed.push({
        id: entry.id,
        name: entry.name,
        persona: entry.persona,
        ...(email === undefined ? {} : { email }),
        ...(goal === undefined ? {} : { goal }),
      });
    }
  }
  return parsed;
}

export function createPgApprovalRoundStore(
  rawDB: DB["db"],
): ApprovalRoundStore {
  if (!(rawDB instanceof PostgresJsDatabase)) {
    throw new Error("Approval rounds require postgres-js");
  }
  const db: ArtifactDb = rawDB;

  async function resolveWorkspaceTenantId(tenantId: string): Promise<string> {
    const [row] = await rawDB
      .select({ parentId: tenant.parentId })
      .from(tenant)
      .where(eq(tenant.id, tenantId));
    if (row === undefined || row.parentId === null) {
      return tenantId;
    }
    return row.parentId;
  }

  async function readWorkspaceReviewersForRoot(
    rootTenantId: string,
  ): Promise<WorkspaceReviewer[]> {
    const [row] = await rawDB
      .select({ fields: settingsRecord.fields })
      .from(settingsRecord)
      .where(
        and(
          eq(settingsRecord.tenantId, rootTenantId),
          eq(settingsRecord.scopeKey, WORKSPACE_REVIEWERS_SCOPE_KEY),
        ),
      );
    return row === undefined
      ? []
      : (parseWorkspaceReviewersField(row.fields) ?? []);
  }

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
      const bundle = parseApprovalPackageBundle(stored.content);
      const projectDocuments: StoredPackageDocument[] = [];
      for (const source of bundle.manifest.sources) {
        if (EXCLUDED_PACKAGE_SOURCE_KINDS.has(source.kind)) continue;
        const row = await getArtifact(db, source.artifactId);
        if (!row || row.tenantId !== actor.tenantId) {
          continue;
        }
        const docVersion = await getArtifactVersion(
          db,
          source.artifactId,
          source.version,
        );
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
        triage: round.triage,
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
        triage: row.triage as TriageItem[],
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
        triage: row.triage as TriageItem[],
      };
    },

    async updateRound(round) {
      await rawDB
        .update(approvalRound)
        .set({
          settledAt: round.settledAt,
          reviewers: round.reviewers,
          triage: round.triage,
        })
        .where(
          and(
            eq(approvalRound.id, round.roundId),
            eq(approvalRound.tenantId, round.tenantId),
            eq(approvalRound.projectId, round.projectId),
          ),
        );
    },

    async transactRound(tenantId, projectId, roundId, fn) {
      return rawDB.transaction(async (tx) => {
        const [row] = await tx
          .select()
          .from(approvalRound)
          .where(
            and(
              eq(approvalRound.id, roundId),
              eq(approvalRound.tenantId, tenantId),
              eq(approvalRound.projectId, projectId),
            ),
          )
          .for("update");
        const stored: StoredApprovalRound | undefined = row
          ? {
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
              triage: row.triage as TriageItem[],
            }
          : undefined;
        return fn(stored, async (updated) => {
          await tx
            .update(approvalRound)
            .set({
              settledAt: updated.settledAt,
              reviewers: updated.reviewers,
              triage: updated.triage,
            })
            .where(
              and(
                eq(approvalRound.id, updated.roundId),
                eq(approvalRound.tenantId, updated.tenantId),
                eq(approvalRound.projectId, updated.projectId),
              ),
            );
        });
      });
    },

    async activeCoordinatorRunId(projectId) {
      const [row] = await rawDB
        .select({ runId: projectCoordinator.runId })
        .from(projectCoordinator)
        .where(
          and(
            eq(projectCoordinator.projectId, projectId),
            eq(projectCoordinator.active, true),
          ),
        );
      return row?.runId;
    },

    async listWorkspaceReviewers(tenantId) {
      const rootTenantId = await resolveWorkspaceTenantId(tenantId);
      return readWorkspaceReviewersForRoot(rootTenantId);
    },

    async saveWorkspaceReviewers(tenantId, additions) {
      const rootTenantId = await resolveWorkspaceTenantId(tenantId);
      const current = await readWorkspaceReviewersForRoot(rootTenantId);
      const next = [...current];
      for (const item of additions) {
        const name = item.name.trim();
        const persona = item.persona.trim();
        if (name === "" || persona === "") continue;
        const email =
          item.email !== undefined && item.email.trim() !== ""
            ? item.email.trim()
            : undefined;
        const goal =
          item.goal !== undefined && item.goal.trim() !== ""
            ? item.goal.trim()
            : undefined;
        const existingIndex = next.findIndex(
          (entry) =>
            entry.name.toLowerCase() === name.toLowerCase() &&
            entry.persona.toLowerCase() === persona.toLowerCase(),
        );
        if (existingIndex === -1) {
          next.push({
            id: `ws-rev-${crypto.randomUUID()}`,
            name,
            persona,
            ...(email === undefined ? {} : { email }),
            ...(goal === undefined ? {} : { goal }),
          });
        } else {
          const existing = next[existingIndex]!;
          next[existingIndex] = {
            ...existing,
            name,
            persona,
            ...(email === undefined ? {} : { email }),
            ...(goal === undefined ? {} : { goal }),
          };
        }
      }
      const fieldsPayload = {
        providerNames: { value: null, version: 0 },
        title: { value: null, version: 0 },
        reviewers: next,
      };
      await rawDB
        .insert(settingsRecord)
        .values({
          tenantId: rootTenantId,
          scopeKey: WORKSPACE_REVIEWERS_SCOPE_KEY,
          projectId: null,
          fields:
            fieldsPayload as unknown as import("@corbits-builder/schemas/settings").SettingsFields,
        })
        .onConflictDoUpdate({
          target: [settingsRecord.tenantId, settingsRecord.scopeKey],
          set: {
            fields:
              fieldsPayload as unknown as import("@corbits-builder/schemas/settings").SettingsFields,
          },
        });
      return next;
    },
  };
}

export type PackageZipReviewerFilter = {
  roundId?: string;
  reviewerId?: string;
  reviewerName?: string;
  persona?: string;
};

export function createApprovalRoundService(store: ApprovalRoundStore) {
  const currentNow = () => (store.now === undefined ? new Date() : store.now());
  const roundLocks = new Map<string, Promise<unknown>>();

  async function waitForLock(
    prev: Promise<unknown> | undefined,
    gate: Promise<void>,
  ): Promise<void> {
    if (prev !== undefined) await prev;
    await gate;
  }

  async function withRoundLock<T>(
    tenantId: string,
    projectId: string,
    roundId: string,
    fn: (
      round: StoredApprovalRound | undefined,
      save: (updated: StoredApprovalRound) => Promise<void>,
    ) => Promise<T>,
  ): Promise<T> {
    const key = `${tenantId}:${projectId}:${roundId}`;
    const prev = roundLocks.get(key);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const queued = waitForLock(prev, gate);
    roundLocks.set(key, queued);
    if (prev !== undefined) await prev;
    try {
      if (store.transactRound !== undefined) {
        return await store.transactRound(tenantId, projectId, roundId, fn);
      }
      const round = await store.readRound(tenantId, projectId, roundId);
      return await fn(round, (updated) => store.updateRound(updated));
    } finally {
      release();
      if (roundLocks.get(key) === queued) {
        roundLocks.delete(key);
      }
    }
  }

  async function resolveReviewerRecipient(
    tenantId: string,
    projectId: string,
    filter?: PackageZipReviewerFilter,
  ): Promise<PackageReviewerRecipient | undefined> {
    if (filter === undefined) return undefined;
    const roundId = filter.roundId?.trim();
    const reviewerId = filter.reviewerId?.trim();
    if (
      roundId !== undefined &&
      roundId !== "" &&
      reviewerId !== undefined &&
      reviewerId !== ""
    ) {
      const round = await store.readRound(tenantId, projectId, roundId);
      const found = round?.reviewers.find((r) => r.id === reviewerId);
      if (found !== undefined) {
        return { name: found.name, persona: found.persona };
      }
    }
    if (reviewerId !== undefined && reviewerId !== "") {
      const rounds = await store.listRounds(tenantId, projectId);
      for (const round of rounds) {
        const found = round.reviewers.find((r) => r.id === reviewerId);
        if (found !== undefined) {
          return { name: found.name, persona: found.persona };
        }
      }
    }
    const reviewerName = filter.reviewerName?.trim();
    if (reviewerName !== undefined && reviewerName !== "") {
      return {
        name: reviewerName,
        persona: filter.persona === undefined ? "" : filter.persona.trim(),
      };
    }
    return undefined;
  }

  return {
    async packageZip(
      actor: Actor,
      projectId: string,
      version: number,
      filter?: PackageZipReviewerFilter,
    ) {
      await store.authorize(actor, projectId, "read");
      const pkg = await store.readPackage(actor, projectId, version);
      const reviewer = await resolveReviewerRecipient(
        actor.tenantId,
        projectId,
        filter,
      );
      return buildPackageArchive(pkg, reviewer);
    },

    async list(actor: Actor, projectId: string): Promise<ApprovalRoundList> {
      await store.authorize(actor, projectId, "read");
      const now = currentNow();
      const rows = await store.listRounds(actor.tenantId, projectId);
      const workspaceReviewers =
        store.listWorkspaceReviewers === undefined
          ? undefined
          : await store.listWorkspaceReviewers(actor.tenantId);
      return {
        rounds: rows.map((row) => serializeRound(row, now)),
        ...(workspaceReviewers === undefined ? {} : { workspaceReviewers }),
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
      for (const reviewer of input.reviewers) {
        if (
          reviewer.name.trim() === "" ||
          reviewer.persona.trim() === "" ||
          (reviewer.email !== undefined && reviewer.email.trim() === "")
        ) {
          throw new ProjectError(400, "invalid_approval_round");
        }
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
      const toSaveToWorkspace = input.reviewers.filter(
        (reviewer) => reviewer.saveToWorkspace === true,
      );
      if (
        toSaveToWorkspace.length > 0 &&
        store.saveWorkspaceReviewers !== undefined
      ) {
        await store.saveWorkspaceReviewers(actor.tenantId, toSaveToWorkspace);
      }
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
          ...(reviewer.goal === undefined || reviewer.goal.trim() === ""
            ? {}
            : { goal: reviewer.goal.trim() }),
        })),
        triage: [],
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
      return withRoundLock(
        actor.tenantId,
        projectId,
        roundId,
        async (round, save) => {
          if (!round) {
            throw new ProjectError(404, "approval_round_not_found", {
              roundId,
            });
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
          const target = round.reviewers[index]!;
          const nextName =
            input.name !== undefined && input.name.trim() !== ""
              ? input.name.trim()
              : target.name;
          const nextPersona =
            input.persona !== undefined && input.persona.trim() !== ""
              ? input.persona.trim()
              : target.persona;
          let nextGoal: string | undefined = target.goal;
          if (input.goal !== undefined) {
            const trimmedGoal = input.goal.trim();
            if (trimmedGoal === "") {
              nextGoal = undefined;
            } else {
              nextGoal = trimmedGoal;
            }
          }
          if (
            input.outcome === undefined &&
            input.name === undefined &&
            input.persona === undefined &&
            input.goal === undefined
          ) {
            throw new ProjectError(400, "invalid_reviewer_decision");
          }
          const trimmedNote = input.note === undefined ? "" : input.note.trim();
          const decision: ReviewerDecision | undefined =
            input.outcome === undefined
              ? target.decision
              : {
                  outcome: input.outcome,
                  ...(trimmedNote === "" ? {} : { note: trimmedNote }),
                  slideNotes:
                    input.slideNotes === undefined ? [] : input.slideNotes,
                  decidedAt: now.toISOString(),
                };
          const updatedReviewer: StoredReviewer = {
            id: target.id,
            name: nextName,
            persona: nextPersona,
            ...(target.email === undefined ? {} : { email: target.email }),
            ...(nextGoal === undefined ? {} : { goal: nextGoal }),
            ...(decision === undefined ? {} : { decision }),
          };
          const updatedReviewers = [...round.reviewers];
          updatedReviewers[index] = updatedReviewer;
          const baseTriage =
            input.outcome === undefined
              ? round.triage
              : round.triage.filter(
                  (item) =>
                    item.reviewerId !== reviewerId || item.status !== "pending",
                );
          const retainedTriage = baseTriage.map((item) =>
            item.reviewerId === reviewerId
              ? {
                  ...item,
                  reviewerName: nextName,
                  persona: nextPersona,
                }
              : item,
          );
          const extractedTriage =
            input.outcome === undefined || decision === undefined
              ? []
              : extractTriageItemsForDecision(
                  round.roundId,
                  updatedReviewer,
                  decision,
                ).filter(
                  (item) =>
                    !retainedTriage.some(
                      (existing) =>
                        existing.reviewerId === item.reviewerId &&
                        existing.slide === item.slide &&
                        existing.text === item.text,
                    ),
                );
          const updatedRound: StoredApprovalRound = {
            ...round,
            reviewers: updatedReviewers,
            triage: [...retainedTriage, ...extractedTriage],
          };
          await save(updatedRound);
          return serializeRound(updatedRound, now);
        },
      );
    },

    async triageItem(
      actor: Actor,
      projectId: string,
      roundId: string,
      itemId: string,
      raw: unknown,
      mailRun?: (runId: string, content: string) => Promise<void>,
    ): Promise<ApprovalRound> {
      const input = TriageDecisionInput(raw);
      if (input instanceof type.errors) {
        throw new ProjectError(400, "invalid_triage_decision", {
          issues: input.summary,
        });
      }
      const trimmedReply = input.reply === undefined ? "" : input.reply.trim();
      if (input.action === "reply" && trimmedReply === "") {
        throw new ProjectError(400, "invalid_triage_decision");
      }
      await store.authorize(actor, projectId, "manage", true);
      return withRoundLock(
        actor.tenantId,
        projectId,
        roundId,
        async (round, save) => {
          if (!round) {
            throw new ProjectError(404, "approval_round_not_found", {
              roundId,
            });
          }
          const itemIndex = round.triage.findIndex(
            (item) => item.itemId === itemId,
          );
          if (itemIndex === -1) {
            throw new ProjectError(404, "triage_item_not_found", {
              roundId,
              itemId,
            });
          }
          const target = round.triage[itemIndex]!;
          if (target.status === "incorporated") {
            throw new ProjectError(409, "triage_item_already_incorporated", {
              roundId,
              itemId,
            });
          }
          let nextStatus: TriageItem["status"] = "dismissed";
          if (input.action === "incorporate") nextStatus = "incorporated";
          if (input.action === "reply") nextStatus = "replied";
          const updatedItem: TriageItem = {
            itemId: target.itemId,
            roundId: target.roundId,
            reviewerId: target.reviewerId,
            reviewerName: target.reviewerName,
            persona: target.persona,
            ...(target.slide === undefined ? {} : { slide: target.slide }),
            text: target.text,
            status: nextStatus,
            ...(input.action === "reply" ? { reply: trimmedReply } : {}),
          };
          const updatedTriage = [...round.triage];
          updatedTriage[itemIndex] = updatedItem;
          const updatedRound: StoredApprovalRound = {
            ...round,
            triage: updatedTriage,
          };
          if (input.action === "incorporate") {
            const coordinatorRunId =
              store.activeCoordinatorRunId === undefined
                ? undefined
                : await store.activeCoordinatorRunId(projectId);
            if (coordinatorRunId === undefined) {
              throw new ProjectError(409, "coordinator_not_running");
            }
            if (mailRun === undefined) {
              throw new ProjectError(503, "run_mail_unavailable");
            }
            let audience: string | undefined;
            try {
              const pkg = await store.readPackage(
                actor,
                projectId,
                round.packageVersion,
              );
              const bundle = parseApprovalPackageBundle(pkg.content);
              audience = bundle.manifest.audience;
            } catch (error) {
              audience = error instanceof Error ? undefined : undefined;
            }
            const reviewer = round.reviewers.find(
              (r) => r.id === target.reviewerId,
            );
            const decisionOutcome = reviewer?.decision?.outcome;
            await save(updatedRound);
            try {
              await mailRun(
                coordinatorRunId,
                incorporatedFeedbackMessage({
                  packageVersion: round.packageVersion,
                  ...(audience === undefined ? {} : { audience }),
                  reviewerName: target.reviewerName,
                  persona: target.persona,
                  ...(decisionOutcome === undefined
                    ? {}
                    : { decision: decisionOutcome }),
                  ...(target.slide === undefined
                    ? {}
                    : { slide: target.slide }),
                  text: target.text,
                }),
              );
            } catch (error) {
              await save(round);
              throw error;
            }
            return serializeRound(updatedRound, currentNow());
          }
          await save(updatedRound);
          return serializeRound(updatedRound, currentNow());
        },
      );
    },

    async settle(
      actor: Actor,
      projectId: string,
      roundId: string,
    ): Promise<ApprovalRound> {
      await store.authorize(actor, projectId, "manage", true);
      return withRoundLock(
        actor.tenantId,
        projectId,
        roundId,
        async (round, save) => {
          if (!round) {
            throw new ProjectError(404, "approval_round_not_found", {
              roundId,
            });
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
          await save(settledRound);
          return serializeRound(settledRound, now);
        },
      );
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
  nativeFetch?: (request: Request) => Promise<Response>,
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
        {
          name: "roundId",
          in: "query",
          required: false,
          schema: { type: "string" },
        },
        {
          name: "reviewerId",
          in: "query",
          required: false,
          schema: { type: "string" },
        },
        {
          name: "reviewerName",
          in: "query",
          required: false,
          schema: { type: "string" },
        },
        {
          name: "persona",
          in: "query",
          required: false,
          schema: { type: "string" },
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
      const roundId = c.req.query("roundId");
      const reviewerId = c.req.query("reviewerId");
      const reviewerName = c.req.query("reviewerName");
      const persona = c.req.query("persona");
      const { filename, archive } = await service.packageZip(
        actorOf(c),
        c.req.param("projectId"),
        version,
        {
          ...(roundId === undefined ? {} : { roundId }),
          ...(reviewerId === undefined ? {} : { reviewerId }),
          ...(reviewerName === undefined ? {} : { reviewerName }),
          ...(persona === undefined ? {} : { persona }),
        },
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

  app.post(
    "/:projectId/approval-rounds/:roundId/triage/:itemId",
    describeRoute({
      tags: ["Artifacts"],
      operationId: "triageReviewerFeedback",
      description:
        "Records the project owner's triage decision (incorporate, dismiss, or reply) on a reviewer feedback bullet. Only incorporating an item mails the coordinator as the owner with the quoted external feedback block.",
      security,
      requestBody: {
        required: true,
        content: {
          "application/json": { schema: resolver(TriageDecisionInput) },
        },
      },
      responses: {
        200: {
          description: "The updated approval round",
          content: {
            "application/json": { schema: resolver(ApprovalRound) },
          },
        },
        400: { description: "Invalid triage decision" },
        403: { description: "Caller is not a person who manages the project" },
        404: { description: "Round or triage item not found" },
        409: { description: "The project has no running coordinator" },
      },
    }),
    async (c) => {
      const current = actorOf(c);
      return c.json(
        await service.triageItem(
          current,
          c.req.param("projectId"),
          c.req.param("roundId"),
          c.req.param("itemId"),
          await body(c),
          (runId, content) =>
            mailRunAsCaller(c, nativeFetch, current.tenantId, runId, content),
        ),
      );
    },
  );
}
