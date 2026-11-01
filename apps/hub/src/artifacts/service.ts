import { stat } from "node:fs/promises";
import { join } from "node:path";
import { type } from "arktype";
import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import {
  createArtifact,
  findOrVersionArtifact,
  getArtifact,
  getArtifactVersion,
  listArtifacts,
  listArtifactVersions,
  MAX_LIST_LIMIT,
  VersionConflictError,
  writeArtifactVersion,
  type ArtifactDb,
} from "@corbits/artifacts";
import type { DB } from "@intx/db";
import { getLogger } from "@intx/log";
import {
  base64Decode,
  base64Encode,
  hasCode,
  validateAttachments,
} from "@intx/types";
import {
  WORKFLOW_RUN_REF,
  workflowRunRepoIdForAddress,
  type RepoStore,
  type WorkflowRunReader,
} from "@intx/hub-sessions";
import {
  approval,
  principal,
  workflowRun,
  workflowRunLaunchSpec,
} from "@intx/db/schema";
import {
  ArtifactApprovalRecord,
  AppBundle,
  AppVersionMetadata,
  DocumentContent,
  MAX_APP_BYTES,
  MATERIAL_KIND,
  ArtifactKindWrite,
  DesignBundle,
  DesignChoice,
  DesignConceptRecord,
  DesignDraft,
  ArtifactRead,
  DesignTweaks,
  type AcceptanceChecklist,
  type AcceptedMaterials,
  type MaterialReceipt,
  type DesignTweaksReceipt,
  type DesignChoiceReceipt,
  type LiveApp,
  type ArtifactApprovalReceipt,
  type ArtifactContent,
  type ArtifactList,
  type ArtifactListItem,
  type DecidedApprovalList,
  type FailedRun,
  type InFlightRun,
  type ArtifactRef,
  type AppSnapshotReceipt,
  type AppSnapshotState,
  type AppVersion,
  type AppVersionList,
} from "@corbits-builder/schemas/artifact";
import type { SpawnedRole } from "@corbits-builder/schemas/installed-workflows";
import { OpenQuestions } from "@corbits-builder/schemas/questions";
import {
  ApproachesMeta,
  approachesIssue,
} from "@corbits-builder/schemas/approaches";
import {
  type ExportSection,
  exportSection,
  ProjectExport,
  ProjectExportMaterial,
} from "@corbits-builder/schemas/project";
import JSZip from "jszip";
import type {
  AgentActivity,
  ProjectActivity,
} from "@corbits-builder/schemas/activity";
import {
  artifactApproval,
  artifactImportApproval,
  designConcept,
  project,
  projectCoordinator,
} from "../db/schema.ts";
import type { AgentActivityTracker } from "./activity.ts";
import type { Actor } from "../lib/actor.ts";
import { parseJson } from "../lib/json.ts";
import { authorizeProject } from "../projects/authorization.ts";
import { ProjectError, projectResource } from "../projects/errors.ts";
import { readAppRepository } from "../projects/app-repository.ts";
import {
  spawnedWorkflowRole,
  spawnedWorkflowStep,
} from "../workflows/spawn-role.ts";
import {
  demoLogin,
  editDesignStyles,
  readAcceptance,
  readDemoLogin,
  readDesignBundle,
  readDesignDraft,
  warmStepWorkspace,
} from "./design-draft.ts";
import type { LiveApps } from "../live-app/runner.ts";
import {
  AppTooLargeError,
  appContent,
  bundleFiles,
} from "../builds/app-snapshot.ts";
import { MAX_DESIGN_BYTES } from "./design-tools.ts";
import { DESIGN_STYLES, setThemeTokens } from "./design-tweaks.ts";
import {
  coordinatorTweaksNote,
  designerTweaksNote,
} from "../config/design-tweaks.ts";
import { designChosenNote } from "../config/design.ts";
import { loadSettings } from "../settings/policy.ts";
import {
  preferenceGuidance,
  resolvePreferences,
} from "../config/preferences.ts";
import { awaitingApproval } from "../projects/deploy-tools.ts";
import { frozenModelChoice, workflowBindings } from "../config/models.ts";
import { modelDirectory } from "../settings/custom-providers.ts";
import { materialsNote } from "../config/materials.ts";
import { servingOffering } from "../workflows/install-for-tenant.ts";
import {
  acceptedMaterials,
  materialContent,
  materialMimeType,
} from "./materials.ts";
import { requestErrorMetadata } from "../request-error.ts";

const log = getLogger(["corbits-builder", "hub", "artifacts"]);

// The native asks are the human approvals. A request_approval approval covers the documents of
// the kinds it asked about and an instruct_coder approval every filed document. The person approves
// the design by choosing a design option. The app is the coder's own output, filed while it works,
// so no approval covers it.
const APPROVAL_COVERS: Record<string, (kind: string) => boolean> = {
  request_approval: (kind) =>
    kind !== "app" && kind !== "design" && kind !== "design_option",
  instruct_coder: (kind) => kind !== "app" && kind !== "design_option",
};
// Whole documents, the filed app among them (up to 1 MiB of source).
const MAX_READ_CHARS = 1024 * 1024;
const RECENT_FAILURES = 5;
const RunError = type({ "+": "delete", message: "string", "code?": "string" });
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const isUuid = (value: string) => new RegExp("^" + UUID + "$", "i").test(value);
// The coder task names documents as id@version@sha256 tokens.
const PINNED_REF = new RegExp("^(" + UUID + ")@(\\d+)@([a-f0-9]{64})$", "i");

const appTooLarge = (error: unknown) =>
  error instanceof AppTooLargeError
    ? new ProjectError(413, "app_too_large", {
        bytes: error.bytes,
        limit: MAX_APP_BYTES,
      })
    : error;

// An imported bundle's paths and a material's filename are the importer's text: none may climb
// out of the directory it is archived under.
const isContainedPath = (path: string) =>
  !path.startsWith("/") && !path.split(/[\\/]/).includes("..");

async function isDirectory(path: string) {
  try {
    return (await stat(path)).isDirectory();
  } catch (error) {
    if (hasCode(error) && error.code === "ENOENT") return false;
    throw error;
  }
}

const artifactResource = (kind: string) => "sb-artifact:" + kind;

// A document version records the open questions it leaves for the person; a version filed without
// them, before they were recorded or by an import, leaves none. An approaches version may also
// record its approaches for a side-by-side comparison.
const DocumentMetadata = type({
  "openQuestions?": OpenQuestions,
  "approaches?": ApproachesMeta,
});
const documentMetadataOf = (metadata: unknown) =>
  DocumentMetadata.assert(metadata ?? {});
const openQuestionsOf = (metadata: unknown) =>
  documentMetadataOf(metadata).openQuestions ?? [];

// The failed step's error names the cause; RunFailed only says a step failed.
// A run the hub failed itself, such as on lost capacity, records why on its row.
export async function runFailure(
  runs: WorkflowRunReader,
  run: {
    runId: string;
    address: string | null;
    failureCode: string | null;
    failureMessage: string | null;
  },
): Promise<FailedRun["error"]> {
  const events = run.address
    ? await runs.readRunEvents(
        workflowRunRepoIdForAddress(run.address),
        WORKFLOW_RUN_REF,
        run.runId,
      )
    : [];
  const terminal =
    events.findLast((event) => event.type === "StepFailed") ??
    events.findLast((event) => event.type === "RunFailed");
  const error = RunError(terminal?.body["error"]);
  if (!(error instanceof type.errors)) return error;
  if (run.failureMessage === null) return undefined;
  return {
    message: run.failureMessage,
    ...(run.failureCode === null ? {} : { code: run.failureCode }),
  };
}

// A project is its own tenant, so the library's tenant scope is the project
// scope. The hub adds project grants and the exact versions each resolved
// native deploy approval covered.
export function createArtifactService(
  rawDB: DB["db"],
  runs: WorkflowRunReader,
  tracker?: AgentActivityTracker,
  sidecarDataDir?: string,
  liveApps?: LiveApps,
  cancelRun?: (
    tenantId: string,
    runId: string,
    reason: string,
  ) => Promise<unknown>,
  repoStore?: RepoStore,
) {
  if (!(rawDB instanceof PostgresJsDatabase))
    throw new Error("Artifacts require postgres-js");
  const db: ArtifactDb = rawDB;

  async function activeCoordinator(projectId: string) {
    const [row] = await rawDB
      .select({ runId: projectCoordinator.runId })
      .from(projectCoordinator)
      .where(
        and(
          eq(projectCoordinator.projectId, projectId),
          eq(projectCoordinator.active, true),
        ),
      );
    return row;
  }

  async function archiveName(projectId: string) {
    const [row] = await rawDB
      .select({ title: project.title })
      .from(project)
      .where(eq(project.id, projectId));
    // The name is the archive's one top directory and its filename: never hidden, never a climb.
    return (
      row!.title
        .replace(/[\\/:*?"<>|\s]+/g, "-")
        .replace(/\.{2,}/g, "-")
        .replace(/^[.-]+/, "") || "app"
    );
  }

  async function requireProject(
    actor: Actor,
    projectId: string,
    action: "read" | "manage",
  ) {
    return (await authorizeProject(rawDB, actor, projectId, action)).allowed;
  }

  // The role's runs, newest first, each with its warm step and the design concept it works on, if
  // any: the live runs, or with ended, every run.
  async function roleRuns(actor: Actor, role: SpawnedRole, ended: boolean) {
    const runs = await rawDB
      .select({
        runId: workflowRun.id,
        address: workflowRun.address,
        bundle: workflowRunLaunchSpec.frozenApprovalBundle,
        concept: designConcept.label,
      })
      .from(workflowRun)
      .innerJoin(
        workflowRunLaunchSpec,
        eq(workflowRunLaunchSpec.anchorRunId, workflowRun.id),
      )
      .leftJoin(designConcept, eq(designConcept.runId, workflowRun.id))
      .where(
        and(
          eq(workflowRun.tenantId, actor.tenantId),
          ended
            ? undefined
            : inArray(workflowRun.status, ["deployed", "running"]),
        ),
      )
      .orderBy(desc(workflowRun.createdAt));
    return runs.flatMap((run) => {
      const step = spawnedWorkflowStep(run.bundle);
      return step?.role === role
        ? [
            {
              runId: run.runId,
              address: run.address,
              stepId: step.stepId,
              concept: run.concept,
            },
          ]
        : [];
    });
  }

  // The workspaces of the role's runs that the hub deployed on its local sidecar, newest first, each
  // with the design concept its run works on, if any: the live runs, or with ended, every run.
  async function liveWorkspaces(
    actor: Actor,
    role: SpawnedRole,
    ended = false,
  ) {
    if (!sidecarDataDir) return [];
    return (await roleRuns(actor, role, ended)).flatMap(
      ({ runId, address, stepId, concept }) =>
        address === null
          ? []
          : [
              {
                runId,
                dir: warmStepWorkspace(sidecarDataDir, address, stepId),
                concept,
              },
            ],
    );
  }

  // The newest coder run's workspace, or why it cannot be snapshotted. Only the newest run is the
  // app's current code; an older run's workspace is stale.
  async function newestCoderWorkspace(
    actor: Actor,
  ): Promise<
    { runId: string; dir: string } | Exclude<AppSnapshotState, { ready: true }>
  > {
    const [run] = await roleRuns(actor, "coder", true);
    if (!run) return { ready: false, code: "coder_run_not_found" };
    const unavailable = (
      reason: NonNullable<
        Extract<AppSnapshotState, { ready: false }>["reason"]
      >,
    ) =>
      ({
        ready: false,
        code: "app_workspace_unavailable",
        runId: run.runId,
        reason,
      }) as const;
    if (!sidecarDataDir || run.address === null)
      return unavailable("not_on_local_sidecar");
    const dir = warmStepWorkspace(sidecarDataDir, run.address, run.stepId);
    if (!(await isDirectory(dir))) return unavailable("workspace_missing");
    if (!(await Bun.file(join(dir, "package.json")).exists()))
      return unavailable("package_json_missing");
    return { runId: run.runId, dir };
  }

  // The newest app version a passing check or an import filed. A snapshot is a person's copy of
  // the workspace at any moment, so it never seeds the next coder or stands as the filed app.
  // Versions filed before sources were recorded came only from checks and imports.
  async function mainLineVersion(artifactId: string) {
    for await (const row of everyVersion(artifactId)) {
      const recorded = AppVersionMetadata(row.metadata);
      if (recorded instanceof type.errors || recorded.source !== "snapshot")
        return row;
    }
    return undefined;
  }

  // Every version of the artifact, newest first, read a page at a time.
  async function* everyVersion(artifactId: string) {
    let cursor: number | undefined;
    do {
      const page = await listArtifactVersions(db, artifactId, {
        limit: MAX_LIST_LIMIT,
        ...(cursor === undefined ? {} : { cursor }),
      });
      yield* page.versions;
      cursor = page.nextCursor === null ? undefined : Number(page.nextCursor);
    } while (cursor !== undefined);
  }

  // The project's main-line app; the caller has checked the project.
  async function filedApp(actor: Actor) {
    const [row] = (
      await listArtifacts(db, actor.tenantId, { kind: "app", limit: 1 })
    ).rows;
    if (!row) return undefined;
    const mainLine = await mainLineVersion(row.id);
    if (mainLine === undefined) return undefined;
    const stored = await getArtifactVersion(db, row.id, mainLine.version);
    if (!stored?.contentSha256) return undefined;
    return {
      version: mainLine.version,
      createdAt: mainLine.createdAt,
      sha256: stored.contentSha256,
      bundle: AppBundle.assert(JSON.parse(stored.content)),
    };
  }

  // The app at the tip of the project's app repository's main when it was committed after
  // filedAt, the time a filed version was written, or with no filed version at all.
  async function newerRepositoryApp(
    actor: Actor,
    projectId: string,
    filedAt: string | undefined,
  ) {
    if (!repoStore) return undefined;
    const main = await readAppRepository(
      rawDB,
      repoStore,
      actor.tenantId,
      projectId,
    );
    if (
      !main ||
      (filedAt !== undefined &&
        main.committedAt.getTime() <= Date.parse(filedAt))
    )
      return undefined;
    const app = await main.read();
    return app && { commit: main.commit, bundle: app.bundle };
  }

  // The latest filed app version or, when its main holds a later commit, the app repository's
  // main, as a bundle and the name of the version; undefined while neither holds an app.
  async function currentApp(actor: Actor, projectId: string) {
    const [latest] = (
      await listArtifacts(db, actor.tenantId, { kind: "app", limit: 1 })
    ).rows;
    const filed = latest?.contentSha256 ? latest : undefined;
    let repository;
    try {
      repository = await newerRepositoryApp(
        actor,
        projectId,
        filed && (await filedAt(filed.id, filed.version)),
      );
    } catch (error) {
      throw appTooLarge(error);
    }
    if (repository)
      return {
        name: repository.commit.slice(0, 7),
        bundle: repository.bundle,
      };
    if (!filed) return undefined;
    const stored = await getArtifactVersion(db, filed.id, filed.version);
    return stored
      ? {
          name: `v${filed.version}`,
          bundle: AppBundle.assert(parseJson(stored.content)),
        }
      : undefined;
  }

  // The project's current files: a coder's workspace while it builds, read where it lies, else
  // the newer of the latest filed app and the app repository's main; undefined while the project
  // has no app files at all, and the error when the repository cannot be read.
  async function appSource(actor: Actor, projectId: string) {
    for (const { dir } of await liveWorkspaces(actor, "coder"))
      if (await Bun.file(join(dir, "package.json")).exists()) {
        const login = await readDemoLogin(dir);
        return {
          key: dir,
          source: { dir },
          shown: {
            source: "builder",
            ...(login ? { demoLogin: login } : {}),
          } as const,
        };
      }
    const filed = await filedApp(actor);
    let repository;
    try {
      repository = await newerRepositoryApp(actor, projectId, filed?.createdAt);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      log.error("Reading the app repository failed: {reason}", {
        projectId,
        reason,
        ...requestErrorMetadata(error),
      });
      return { error: reason };
    }
    if (repository) {
      const login = demoLogin(repository.bundle.files);
      return {
        key: repository.commit,
        source: repository.bundle,
        shown: {
          source: "repository",
          commit: repository.commit,
          ...(login ? { demoLogin: login } : {}),
        } as const,
      };
    }
    if (!filed) return undefined;
    const login = demoLogin(filed.bundle.files);
    return {
      key: filed.sha256,
      source: filed.bundle,
      shown: {
        source: "filed",
        version: filed.version,
        ...(login ? { demoLogin: login } : {}),
      } as const,
    };
  }

  // The project's current files to run, or the app's state when there are none to run.
  async function runnableApp(actor: Actor, projectId: string) {
    await requireProject(actor, projectId, "read");
    if (!liveApps) throw new ProjectError(503, "live_app_unavailable");
    const current = await appSource(actor, projectId);
    if (current && current.error === undefined) return current;
    liveApps.runner.stop(projectId);
    return current
      ? ({
          state: "failed",
          source: "repository",
          error: current.error,
        } as const)
      : ({ state: "not_built" } as const);
  }

  function liveAppState(
    routeTenantId: string,
    projectId: string,
    shown: Pick<LiveApp, "source" | "version" | "commit" | "demoLogin">,
  ): LiveApp {
    const { proxy, runner } = liveApps!;
    const run = runner.state(projectId);
    if (run?.state !== "running") proxy.withdraw(projectId);
    if (!run) return { state: "stopped", ...shown };
    if (run.state !== "running") return { ...run, ...shown };
    return {
      state: "running",
      ...shown,
      url: proxy.expose({ tenantId: routeTenantId, projectId }, run.url),
    };
  }

  // The concept of the designer run writing as actor: a workflow principal's ref is its run.
  async function runConcept(actor: Actor) {
    const [row] = await rawDB
      .select({ label: designConcept.label })
      .from(principal)
      .innerJoin(designConcept, eq(designConcept.runId, principal.refId))
      .where(
        and(
          eq(principal.id, actor.principalId),
          eq(designConcept.tenantId, actor.tenantId),
        ),
      );
    return row?.label;
  }

  // A workflow writes the app only as the coder's run: its tools hold no app write, and its
  // sidecar files the app only when check-app passes (sidecar-tools.ts fileCheckedApp). A person's
  // write is an import.
  async function appWriteMetadata(
    writer: { kind: string; refId: string } | undefined,
    content: string,
  ) {
    const bytes = Buffer.byteLength(content);
    if (writer?.kind !== "workflow")
      return AppVersionMetadata.assert({ source: "import", bytes });
    const [run] = await rawDB
      .select({ bundle: workflowRunLaunchSpec.frozenApprovalBundle })
      .from(workflowRunLaunchSpec)
      .where(eq(workflowRunLaunchSpec.anchorRunId, writer.refId));
    if (!run || spawnedWorkflowRole(run.bundle) !== "coder")
      throw new ProjectError(403, "app_write_not_coder");
    return AppVersionMetadata.assert({
      source: "check",
      runId: writer.refId,
      bytes,
    });
  }

  // When the store wrote this version; the page before version + 1 opens on it.
  async function filedAt(artifactId: string, version: number) {
    const [row] = (
      await listArtifactVersions(db, artifactId, {
        cursor: version + 1,
        limit: 1,
      })
    ).versions;
    if (row?.version !== version)
      throw new ProjectError(404, "artifact_not_found", {
        artifactId,
        version,
      });
    return row.createdAt;
  }

  async function approvedVersion(tenantId: string, artifactId: string) {
    const deployed = await rawDB
      .select({
        version: artifactApproval.version,
        sha256: artifactApproval.sha256,
      })
      .from(artifactApproval)
      .where(
        and(
          eq(artifactApproval.tenantId, tenantId),
          eq(artifactApproval.artifactId, artifactId),
        ),
      );
    const imported = await rawDB
      .select({
        version: artifactImportApproval.version,
        sha256: artifactImportApproval.sha256,
      })
      .from(artifactImportApproval)
      .where(
        and(
          eq(artifactImportApproval.tenantId, tenantId),
          eq(artifactImportApproval.artifactId, artifactId),
        ),
      );
    const covered = [...deployed, ...imported].sort(
      (a, b) => b.version - a.version,
    );
    for (const row of covered) {
      const stored = await getArtifactVersion(db, artifactId, row.version);
      if (stored?.contentSha256 === row.sha256) return row.version;
    }
    return undefined;
  }

  return {
    async list(actor: Actor, projectId: string): Promise<ArtifactList> {
      await requireProject(actor, projectId, "read");
      // Native run state is the truth about who is at work; the coordinator
      // decides from it instead of recalling which writer it spawned.
      const specialists = await rawDB
        .select({
          runId: workflowRun.id,
          status: workflowRun.status,
          address: workflowRun.address,
          startedAt: workflowRun.createdAt,
          endedAt: workflowRun.endedAt,
          failureCode: workflowRun.failureCode,
          failureMessage: workflowRun.failureMessage,
          bundle: workflowRunLaunchSpec.frozenApprovalBundle,
          concept: designConcept.label,
        })
        .from(workflowRun)
        .innerJoin(
          workflowRunLaunchSpec,
          eq(workflowRunLaunchSpec.anchorRunId, workflowRun.id),
        )
        .leftJoin(designConcept, eq(designConcept.runId, workflowRun.id))
        .where(
          and(
            eq(workflowRun.tenantId, actor.tenantId),
            inArray(workflowRun.status, ["deployed", "running", "failed"]),
          ),
        )
        .orderBy(desc(workflowRun.endedAt));
      const inFlight: InFlightRun[] = [];
      const failed: FailedRun[] = [];
      for (const run of specialists) {
        const role = spawnedWorkflowRole(run.bundle);
        if (!role) continue;
        if (run.status === "deployed" || run.status === "running") {
          const seen = tracker?.of(run.runId);
          const progress = tracker?.progress(run.runId);
          inFlight.push({
            runId: run.runId,
            role,
            startedAt: run.startedAt.toISOString(),
            status: run.status,
            state: seen?.working ? "working" : "waiting",
            ...(seen?.since ? { since: seen.since } : {}),
            ...(run.concept === null ? {} : { concept: run.concept }),
            ...(progress ? { progress } : {}),
          });
        } else if (run.endedAt && failed.length < RECENT_FAILURES) {
          const error = await runFailure(runs, run);
          failed.push({
            runId: run.runId,
            role,
            endedAt: run.endedAt.toISOString(),
            ...(error ? { error } : {}),
          });
        }
      }
      const { rows } = await listArtifacts(db, actor.tenantId, {
        limit: MAX_LIST_LIMIT,
      });
      const artifacts: ArtifactListItem[] = [];
      for (const row of rows) {
        if (!row.contentSha256) continue;
        const approved = await approvedVersion(actor.tenantId, row.id);
        const openQuestionCount = openQuestionsOf(row.metadata).length;
        artifacts.push({
          artifactId: row.id,
          kind: row.kind,
          title: row.title,
          version: row.version,
          sha256: row.contentSha256,
          filedAt: await filedAt(row.id, row.version),
          ...(approved === undefined ? {} : { approvedVersion: approved }),
          ...(openQuestionCount ? { openQuestionCount } : {}),
        });
      }
      const settings = await loadSettings(rawDB, actor.tenantId, projectId);
      const preferences = resolvePreferences(settings.preferences.value);
      return {
        artifacts,
        inFlight,
        failed,
        awaitingApproval: awaitingApproval(artifacts, preferences).map(
          (item) => item.kind,
        ),
        preferences,
        preferenceGuidance: preferenceGuidance(preferences, "coordinator"),
      };
    },

    // Any agent is at work only inside a message run; a parked specialist's run stays deployed
    // or running between turns.
    async activity(actor: Actor, projectId: string): Promise<ProjectActivity> {
      await requireProject(actor, projectId, "read");
      const agents: AgentActivity[] = [];
      const coordinator = await activeCoordinator(projectId);
      const seen = coordinator && tracker?.of(coordinator.runId);
      if (coordinator && seen?.working && seen.since)
        agents.push({
          runId: coordinator.runId,
          role: "coordinator",
          since: seen.since,
          tools: seen.tools,
          ...(seen.said ? { said: seen.said } : {}),
        });
      const specialists = await rawDB
        .select({
          runId: workflowRun.id,
          bundle: workflowRunLaunchSpec.frozenApprovalBundle,
        })
        .from(workflowRun)
        .innerJoin(
          workflowRunLaunchSpec,
          eq(workflowRunLaunchSpec.anchorRunId, workflowRun.id),
        )
        .where(
          and(
            eq(workflowRun.tenantId, actor.tenantId),
            inArray(workflowRun.status, ["deployed", "running"]),
          ),
        )
        .orderBy(workflowRun.createdAt);
      for (const run of specialists) {
        const role = spawnedWorkflowRole(run.bundle);
        if (!role) continue;
        const shown = tracker?.of(run.runId);
        // A finished specialist stays parked for follow-up mail; only a turn in progress is work,
        // timed from that turn's start rather than the run's deploy.
        if (!shown?.working || !shown.since) continue;
        agents.push({
          runId: run.runId,
          role,
          since: shown.since,
          tools: shown.tools,
          ...(shown.said ? { said: shown.said } : {}),
        });
      }
      return { agents };
    },

    // The native list reads pending asks only; a card the person already decided reads its outcome
    // here. The project is its own tenant, so every approval in it is the project's. Reading tool
    // arguments takes the same tenant-wide grant the native list does.
    async decidedApprovals(
      actor: Actor,
      projectId: string,
    ): Promise<DecidedApprovalList> {
      const allowed = await requireProject(actor, projectId, "read");
      if (!(await allowed("approval:*", "resolve")))
        throw new ProjectError(403, "forbidden");
      const rows = await rawDB
        .select({
          id: approval.id,
          toolName: sql<string>`${approval.toolDefinition}->>'name'`,
          toolArguments: approval.toolArguments,
          status: approval.status,
          scope: approval.scope,
          createdAt: approval.createdAt,
          resolvedAt: approval.resolvedAt,
        })
        .from(approval)
        .where(
          and(
            eq(approval.tenantId, actor.tenantId),
            ne(approval.status, "pending"),
          ),
        )
        .orderBy(approval.createdAt);
      const recorded = await rawDB
        .select({
          approvalId: artifactApproval.approvalId,
          kind: artifactApproval.kind,
          version: artifactApproval.version,
        })
        .from(artifactApproval)
        .where(
          and(
            eq(artifactApproval.tenantId, actor.tenantId),
            eq(artifactApproval.projectId, projectId),
          ),
        );
      return {
        approvals: rows.flatMap((row) =>
          row.status === "pending"
            ? []
            : [
                {
                  approvalId: row.id,
                  toolName: row.toolName,
                  toolArguments: row.toolArguments as Record<string, unknown>,
                  status: row.status,
                  scope: row.scope,
                  createdAt: row.createdAt.toISOString(),
                  resolvedAt: row.resolvedAt?.toISOString() ?? null,
                  documents: recorded
                    .filter((item) => item.approvalId === row.id)
                    .map(({ kind, version }) => ({ kind, version })),
                },
              ],
        ),
      };
    },

    // The newest draft an earlier designer run left for the calling designer run's concept, so a
    // design dispatched again continues that draft instead of starting over.
    async previousDesignDraft(
      actor: Actor,
      projectId: string,
    ): Promise<DesignDraft> {
      await requireProject(actor, projectId, "read");
      const [self] = await rawDB
        .select({ runId: principal.refId })
        .from(principal)
        .where(
          and(
            eq(principal.id, actor.principalId),
            eq(principal.tenantId, actor.tenantId),
            eq(principal.kind, "workflow"),
          ),
        );
      if (!self) throw new ProjectError(403, "not_a_designer_run");
      const concept = await runConcept(actor);
      for (const workspace of await liveWorkspaces(actor, "designer", true)) {
        if (
          workspace.runId === self.runId ||
          (workspace.concept ?? undefined) !== concept
        )
          continue;
        const files = await readDesignBundle(workspace.dir);
        if (files === undefined) continue;
        const draft = DesignDraft.assert({ files });
        if (Buffer.byteLength(JSON.stringify(draft)) > MAX_DESIGN_BYTES)
          throw new ProjectError(409, "design_draft_too_large");
        return draft;
      }
      throw new ProjectError(404, "design_draft_not_found");
    },

    // Without a concept, the draft of the designer working on the design itself.
    async designDraft(
      actor: Actor,
      projectId: string,
      concept?: string,
    ): Promise<DesignDraft> {
      await requireProject(actor, projectId, "read");
      for (const workspace of await liveWorkspaces(actor, "designer")) {
        if ((workspace.concept ?? undefined) !== concept) continue;
        const files = await readDesignDraft(workspace.dir);
        if (files === undefined) continue;
        const draft = DesignDraft.assert({ files });
        if (Buffer.byteLength(JSON.stringify(draft)) > MAX_DESIGN_BYTES)
          throw new ProjectError(409, "design_draft_too_large");
        return draft;
      }
      throw new ProjectError(404, "design_draft_not_found");
    },

    // The person's saved look tokens, written deterministically wherever the design lives: the
    // live designer's styles.css and the filed design's next version, both when both exist, so
    // what the person sees is never stale. A save is never an approval, so no approval is
    // recorded and the approved version stays where it was.
    async saveDesignTweaks(
      actor: Actor,
      projectId: string,
      raw: unknown,
      mailRun: (runId: string, content: string) => Promise<void>,
    ): Promise<DesignTweaksReceipt> {
      const input = DesignTweaks(raw);
      if (input instanceof type.errors)
        throw new ProjectError(400, "invalid_design_tweaks", {
          issues: input.summary,
        });
      await requireProject(actor, projectId, "manage");
      const tokens: Record<string, string> = input.tokens;
      let designerRunId: string | undefined;
      for (const workspace of await liveWorkspaces(actor, "designer")) {
        if ((workspace.concept ?? undefined) !== input.concept) continue;
        if ((await readDesignDraft(workspace.dir)) === undefined) continue;
        await editDesignStyles(workspace.dir, (css) =>
          setThemeTokens(css, tokens),
        );
        designerRunId = workspace.runId;
        break;
      }
      let artifact: ArtifactRef | undefined;
      // A concept's option is titled with its label; without a concept, the design itself.
      const kind = input.concept === undefined ? "design" : "design_option";
      const [filed] = (
        await listArtifacts(db, actor.tenantId, { kind, limit: MAX_LIST_LIMIT })
      ).rows.filter(
        (row) =>
          row.contentSha256 &&
          (input.concept === undefined || row.title === input.concept),
      );
      if (!filed && designerRunId === undefined)
        throw new ProjectError(404, "design_not_found");
      if (filed) {
        const stored = await getArtifactVersion(db, filed.id, filed.version);
        if (!stored) throw new ProjectError(409, "invalid_design");
        const bundle = DesignBundle(parseJson(stored.content));
        if (bundle instanceof type.errors)
          throw new ProjectError(409, "invalid_design", {
            issues: bundle.summary,
          });
        const files = {
          ...bundle.files,
          [DESIGN_STYLES]: setThemeTokens(
            bundle.files[DESIGN_STYLES] ?? "",
            tokens,
          ),
        };
        const written = await writeArtifactVersion(db, {
          scope: actor,
          artifactId: filed.id,
          title: filed.title,
          content: JSON.stringify({ files }),
        });
        artifact = {
          artifactId: written.artifactId,
          kind,
          version: written.version,
          sha256: written.contentSha256!,
        };
      }
      const updated: DesignTweaksReceipt["updated"] = [
        ...(designerRunId === undefined ? [] : ["workspace" as const]),
        ...(artifact ? ["version" as const] : []),
      ];
      const notified: DesignTweaksReceipt["notified"] = [];
      const coordinator = await activeCoordinator(projectId);
      if (coordinator) {
        await mailRun(
          coordinator.runId,
          coordinatorTweaksNote(tokens, updated),
        );
        notified.push("coordinator");
      }
      if (designerRunId) {
        await mailRun(designerRunId, designerTweaksNote(tokens));
        notified.push("designer");
      }
      return { updated, ...(artifact ? { artifact } : {}), notified };
    },

    // What the coordinator's model reads, by the capabilities its catalog offering declares.
    async acceptedMaterials(
      actor: Actor,
      projectId: string,
    ): Promise<AcceptedMaterials> {
      await requireProject(actor, projectId, "read");
      const { models } = await loadSettings(rawDB, actor.tenantId, projectId);
      const directory = await modelDirectory(rawDB, actor.tenantId);
      const choice = frozenModelChoice(directory, models.value);
      const offering =
        choice &&
        (await servingOffering(
          rawDB,
          directory,
          actor.tenantId,
          workflowBindings(directory, choice).coordinator,
        ));
      return acceptedMaterials(offering?.capabilities ?? []);
    },

    // Each attached file is filed as a material and mailed to the coordinator, whose model reads it
    // as an attachment.
    async attachMaterials(
      actor: Actor,
      projectId: string,
      files: readonly File[],
      message: string,
      mailRun: (
        runId: string,
        content: string,
        attachments: { name: string; mimeType: string; data: string }[],
      ) => Promise<void>,
    ): Promise<MaterialReceipt> {
      const allowed = await requireProject(actor, projectId, "manage");
      if (!(await allowed(artifactResource(MATERIAL_KIND), "write")))
        throw new ProjectError(403, "artifact_write_refused", {
          kind: MATERIAL_KIND,
        });
      if (files.length === 0) throw new ProjectError(400, "material_missing");
      const inputs = await Promise.all(
        files.map(async (file) => ({
          name: file.name,
          mimeType: materialMimeType(file),
          data: new Uint8Array(await file.arrayBuffer()),
        })),
      );
      const checked = validateAttachments(inputs);
      if (!checked.ok)
        throw new ProjectError(400, checked.error.code, checked.error);
      const { mimeTypes } = await this.acceptedMaterials(actor, projectId);
      const refused = inputs.find(
        (input) => !mimeTypes.includes(input.mimeType),
      );
      if (refused)
        throw new ProjectError(400, "material_type_not_accepted", {
          name: refused.name,
          mimeType: refused.mimeType,
          accepted: mimeTypes,
        });
      const coordinator = await activeCoordinator(projectId);
      if (!coordinator) throw new ProjectError(409, "coordinator_not_running");
      const materials: ArtifactRef[] = [];
      for (const input of inputs) {
        const { artifact } = await findOrVersionArtifact(db, {
          scope: actor,
          ownerPrincipalId: actor.principalId,
          kind: MATERIAL_KIND,
          title: input.name,
          content: materialContent(input.mimeType, input.data),
          source: { origin: "manual" },
        });
        materials.push({
          artifactId: artifact.id,
          kind: artifact.kind,
          version: artifact.version,
          sha256: artifact.contentSha256!,
        });
      }
      await mailRun(
        coordinator.runId,
        message.trim() || materialsNote(inputs.map((input) => input.name)),
        inputs.map((input) => ({ ...input, data: base64Encode(input.data) })),
      );
      return { materials };
    },

    // An imported document with no kind of its own, filed as a material without mail: the
    // import's opening message names it to the coordinator.
    async fileMaterial(
      actor: Actor,
      projectId: string,
      input: ProjectExportMaterial,
    ): Promise<ArtifactRef> {
      const material = ProjectExportMaterial(input);
      if (material instanceof type.errors)
        throw new ProjectError(400, "invalid_material", {
          issues: material.summary,
        });
      const allowed = await requireProject(actor, projectId, "manage");
      if (!(await allowed(artifactResource(MATERIAL_KIND), "write")))
        throw new ProjectError(403, "artifact_write_refused", {
          kind: MATERIAL_KIND,
        });
      const { artifact } = await findOrVersionArtifact(db, {
        scope: actor,
        ownerPrincipalId: actor.principalId,
        kind: MATERIAL_KIND,
        ...material,
        source: { origin: "manual" },
      });
      return {
        artifactId: artifact.id,
        kind: artifact.kind,
        version: artifact.version,
        sha256: artifact.contentSha256!,
      };
    },

    // routeTenantId is the tenant the caller named, so the app's origin checks each request
    // against the same project route the person reads. Reading never starts the app.
    async liveApp(
      actor: Actor,
      routeTenantId: string,
      projectId: string,
    ): Promise<LiveApp> {
      const current = await runnableApp(actor, projectId);
      if ("state" in current) return current;
      return liveAppState(routeTenantId, projectId, current.shown);
    },

    // The project is open: its app runs from the project's current files until no one has had it
    // open for a short while, and a person who comes back starts it again.
    async keepLiveApp(
      actor: Actor,
      routeTenantId: string,
      projectId: string,
    ): Promise<LiveApp> {
      const current = await runnableApp(actor, projectId);
      if ("state" in current) return current;
      await liveApps!.runner.keepAlive(projectId, current);
      return liveAppState(routeTenantId, projectId, current.shown);
    },

    async acceptance(
      actor: Actor,
      projectId: string,
    ): Promise<AcceptanceChecklist> {
      await requireProject(actor, projectId, "read");
      for (const { dir } of await liveWorkspaces(actor, "coder")) {
        const markdown = await readAcceptance(dir);
        if (markdown !== undefined) return { markdown };
      }
      // Once the coder ends, the checklist is the one it filed with the app.
      const filed = await filedApp(actor);
      const markdown = filed?.bundle.files["ACCEPTANCE.md"];
      if (markdown !== undefined) return { markdown };
      throw new ProjectError(404, "acceptance_not_found");
    },

    async read(
      actor: Actor,
      projectId: string,
      raw: unknown,
    ): Promise<ArtifactContent> {
      const input = ArtifactRead(raw);
      if (input instanceof type.errors)
        throw new ProjectError(400, "invalid_artifact_read", {
          issues: input.summary,
        });
      await requireProject(actor, projectId, "read");
      const pinned = input.artifactId?.match(PINNED_REF);
      const version = pinned ? Number(pinned[2]) : input.version;
      const byKind =
        input.kind ??
        (input.artifactId && !pinned && !isUuid(input.artifactId)
          ? input.artifactId
          : undefined);
      const artifactId = pinned
        ? pinned[1]
        : byKind
          ? (
              await listArtifacts(db, actor.tenantId, {
                kind: byKind,
                limit: 1,
              })
            ).rows[0]?.id
          : input.artifactId;
      if (!artifactId) {
        if (!byKind)
          throw new ProjectError(404, "artifact_not_found", {
            hint: "call read_artifact with no arguments to list artifactIds and kinds",
          });
        // The hint names what is filed, so a missing kind needs no second call; a model that
        // re-reads to confirm a miss trips the doom loop. Tool wrappers relay only the hint.
        const { rows } = await listArtifacts(db, actor.tenantId, {
          limit: MAX_LIST_LIMIT,
        });
        const filed = rows
          .filter((row) => row.contentSha256)
          .map((row) => row.kind);
        throw new ProjectError(404, "artifact_not_found", {
          hint: `no ${byKind} document has been written yet; filed kinds: ${filed.join(", ") || "none"}`,
        });
      }
      // readArtifact is the model-facing chunked reader (8000-character budget);
      // the hub serves whole documents, so it reads the stored version directly.
      const row = await getArtifact(db, artifactId);
      if (!row || row.tenantId !== actor.tenantId)
        throw new ProjectError(404, "artifact_not_found", { artifactId });
      // The app by its kind is the main line; snapshots are read by their version.
      const resolved =
        version ??
        (byKind === "app" && !pinned
          ? (await mainLineVersion(artifactId))?.version
          : row.version);
      if (resolved === undefined)
        throw new ProjectError(404, "artifact_not_found", {
          hint: "no app version has been filed by a passing check or an import yet",
        });
      const stored = await getArtifactVersion(db, artifactId, resolved);
      if (!stored?.contentSha256)
        throw new ProjectError(404, "artifact_not_found", {
          artifactId,
          version,
        });
      if (pinned && stored.contentSha256 !== pinned[3]!.toLowerCase())
        throw new ProjectError(409, "artifact_hash_mismatch", {
          artifactId,
          version,
        });
      if (stored.content.length > MAX_READ_CHARS)
        throw new ProjectError(409, "artifact_too_large", {
          artifactId,
          contentLength: stored.content.length,
          limit: MAX_READ_CHARS,
        });
      const { openQuestions = [], approaches } = documentMetadataOf(
        stored.metadata,
      );
      return {
        artifactId,
        kind: row.kind,
        title: stored.title,
        version: stored.version,
        sha256: stored.contentSha256,
        filedAt: await filedAt(artifactId, stored.version),
        content: stored.content,
        ...(openQuestions.length ? { openQuestions } : {}),
        ...(approaches ? { approaches } : {}),
      };
    },

    // One artifact per kind per project, written at its next version. The hub
    // assigns ids and versions; the caller names only the kind.
    async write(
      actor: Actor,
      projectId: string,
      raw: unknown,
    ): Promise<{ artifact: ArtifactRef }> {
      const input = ArtifactKindWrite(raw);
      if (input instanceof type.errors)
        throw new ProjectError(400, "invalid_artifact_write", {
          issues: input.summary,
        });
      const bundled =
        input.kind === "design" ||
        input.kind === "design_option" ||
        input.kind === "app";
      if (bundled && input.openQuestions)
        throw new ProjectError(400, "invalid_artifact_write", {
          issues: "openQuestions belong to documents, not a " + input.kind,
        });
      if (input.approaches) {
        if (input.kind !== "approaches")
          throw new ProjectError(400, "invalid_artifact_write", {
            issues:
              "approaches belong to the approaches document, not a " +
              input.kind,
          });
        const issue = approachesIssue(input.approaches);
        if (issue)
          throw new ProjectError(400, "invalid_artifact_write", {
            issues: issue,
          });
      }
      if (bundled) {
        const bundle = (input.kind === "app" ? AppBundle : DesignBundle)(
          parseJson(input.content),
        );
        if (bundle instanceof type.errors)
          throw new ProjectError(400, "invalid_" + input.kind, {
            issues: bundle.summary,
          });
      }
      if (input.kind === "app") {
        const bytes = Buffer.byteLength(input.content);
        if (bytes > MAX_APP_BYTES)
          throw new ProjectError(413, "app_too_large", {
            bytes,
            limit: MAX_APP_BYTES,
          });
      } else {
        const document = DocumentContent(input.content);
        if (document instanceof type.errors)
          throw new ProjectError(400, "invalid_artifact_write", {
            issues: document.summary,
          });
      }
      const allowed = await requireProject(actor, projectId, "read");
      if (!(await allowed(artifactResource(input.kind), "write")))
        throw new ProjectError(403, "artifact_write_refused", {
          kind: input.kind,
        });
      const [active] = await rawDB
        .select({ kind: principal.kind, refId: principal.refId })
        .from(principal)
        .where(eq(principal.id, actor.principalId));
      // Each document version states its own open questions, so a revision never inherits the ones
      // its answers settled.
      const metadata =
        input.kind === "app"
          ? await appWriteMetadata(active, input.content)
          : bundled
            ? undefined
            : {
                openQuestions: input.openQuestions ?? [],
                ...(input.approaches ? { approaches: input.approaches } : {}),
              };
      // A design option belongs to the concept its writing designer run was deployed for, and the
      // concept's label is its title, so each concept keeps one option of its own. A concept's
      // designer never files the design itself: the person's pick among the options does.
      const concept =
        input.kind === "design" || input.kind === "design_option"
          ? await runConcept(actor)
          : undefined;
      if (input.kind === "design_option" && !concept)
        throw new ProjectError(409, "design_concept_unknown");
      if (input.kind === "design" && concept)
        throw new ProjectError(409, "design_concept_option", {
          hint: "this designer works on a design concept; file_design_option files it",
        });
      const title = concept ?? input.title;
      const [existing] = concept
        ? (
            await listArtifacts(db, actor.tenantId, {
              kind: input.kind,
              limit: MAX_LIST_LIMIT,
            })
          ).rows.filter((row) => row.title === concept)
        : (
            await listArtifacts(db, actor.tenantId, {
              kind: input.kind,
              limit: 1,
            })
          ).rows;
      if (existing && input.kind === "app") {
        const held = (await mainLineVersion(existing.id))?.version;
        const stored =
          held === undefined
            ? undefined
            : await getArtifactVersion(db, existing.id, held);
        if (stored?.contentSha256 && stored.content === input.content)
          return {
            artifact: {
              artifactId: existing.id,
              kind: "app",
              version: stored.version,
              sha256: stored.contentSha256,
            },
          };
      }
      if (existing) {
        const written = await writeArtifactVersion(db, {
          scope: actor,
          artifactId: existing.id,
          title,
          content: input.content,
          ...(metadata ? { metadata } : {}),
        });
        return {
          artifact: {
            artifactId: written.artifactId,
            kind: input.kind,
            version: written.version,
            sha256: written.contentSha256!,
          },
        };
      }
      const created = await db.transaction((tx) =>
        createArtifact(tx, {
          scope: actor,
          ownerPrincipalId: actor.principalId,
          kind: input.kind,
          title,
          content: input.content,
          source: { origin: active?.kind === "user" ? "manual" : "workflow" },
          ...(metadata ? { metadata } : {}),
        }),
      );
      return {
        artifact: {
          artifactId: created.id,
          kind: created.kind,
          version: created.version,
          sha256: created.contentSha256!,
        },
      };
    },

    async export(actor: Actor, projectId: string): Promise<ProjectExport> {
      await requireProject(actor, projectId, "read");
      const [row] = await rawDB
        .select({ title: project.title })
        .from(project)
        .where(eq(project.id, projectId));
      const { rows } = await listArtifacts(db, actor.tenantId, {
        limit: MAX_LIST_LIMIT,
      });
      const documents = [];
      // Design options are the candidates of one design round; the picked one is the design.
      // Materials are the person's own files, which a document export does not carry.
      for (const artifact of rows) {
        if (
          !artifact.contentSha256 ||
          artifact.kind === "design_option" ||
          artifact.kind === MATERIAL_KIND
        )
          continue;
        const stored = await getArtifactVersion(
          db,
          artifact.id,
          artifact.version,
        );
        if (!stored) continue;
        documents.push({
          kind: artifact.kind,
          title: stored.title,
          content: stored.content,
          approved:
            (await approvedVersion(actor.tenantId, artifact.id)) ===
            stored.version,
        });
      }
      return ProjectExport.assert({
        format: "corbits-builder.project",
        version: 1,
        title: row!.title,
        documents,
      });
    },

    // Files the project's latest coder workspace, live or ended, as the next app version whatever
    // its check or approval state, unless the latest version already holds exactly these files.
    async snapshotApp(
      actor: Actor,
      projectId: string,
    ): Promise<AppSnapshotReceipt> {
      await requireProject(actor, projectId, "manage");
      const workspace = await newestCoderWorkspace(actor);
      if ("code" in workspace)
        throw workspace.code === "coder_run_not_found"
          ? new ProjectError(404, workspace.code)
          : new ProjectError(409, workspace.code, {
              runId: workspace.runId,
              reason: workspace.reason,
            });
      let content: string;
      try {
        content = await appContent(workspace.dir);
      } catch (error) {
        throw appTooLarge(error);
      }
      const metadata = AppVersionMetadata.assert({
        source: "snapshot",
        runId: workspace.runId,
        bytes: Buffer.byteLength(content),
      });
      const [existing] = (
        await listArtifacts(db, actor.tenantId, { kind: "app", limit: 1 })
      ).rows;
      if (existing) {
        const latest = await getArtifactVersion(
          db,
          existing.id,
          existing.version,
        );
        if (latest?.contentSha256 && latest.content === content)
          return {
            artifact: {
              artifactId: existing.id,
              kind: "app",
              version: existing.version,
              sha256: latest.contentSha256,
            },
            filed: false,
            runId: workspace.runId,
          };
        let written;
        try {
          written = await writeArtifactVersion(db, {
            scope: actor,
            artifactId: existing.id,
            title: "App",
            content,
            metadata,
            expectedVersion: existing.version,
          });
        } catch (error) {
          if (error instanceof VersionConflictError)
            throw new ProjectError(409, "app_version_conflict", {
              version: existing.version,
            });
          throw error;
        }
        return {
          artifact: {
            artifactId: written.artifactId,
            kind: "app",
            version: written.version,
            sha256: written.contentSha256!,
          },
          filed: true,
          runId: workspace.runId,
        };
      }
      const created = await db.transaction((tx) =>
        createArtifact(tx, {
          scope: actor,
          ownerPrincipalId: actor.principalId,
          kind: "app",
          title: "App",
          content,
          source: { origin: "manual" },
          metadata,
        }),
      );
      return {
        artifact: {
          artifactId: created.id,
          kind: "app",
          version: created.version,
          sha256: created.contentSha256!,
        },
        filed: true,
        runId: workspace.runId,
      };
    },

    // Every filed version of the project's app, newest first, and whether this viewer can
    // snapshot the current code now.
    async appVersions(
      actor: Actor,
      projectId: string,
    ): Promise<AppVersionList> {
      const allowed = await requireProject(actor, projectId, "read");
      const workspace = (await allowed(projectResource(projectId), "manage"))
        ? await newestCoderWorkspace(actor)
        : ({ ready: false, code: "forbidden" } as const);
      const snapshot: AppSnapshotState =
        "dir" in workspace
          ? { ready: true, runId: workspace.runId }
          : workspace;
      const [app] = (
        await listArtifacts(db, actor.tenantId, { kind: "app", limit: 1 })
      ).rows;
      if (!app) return { versions: [], snapshot };
      const versions: AppVersion[] = [];
      for await (const row of everyVersion(app.id)) {
        const recorded = AppVersionMetadata(row.metadata);
        // A version filed before its source and size were recorded lists neither.
        versions.push({
          version: row.version,
          createdAt: row.createdAt,
          ...(recorded instanceof type.errors
            ? {}
            : {
                source: recorded.source,
                bytes: recorded.bytes,
                ...(recorded.runId ? { runId: recorded.runId } : {}),
              }),
        });
      }
      return { versions, snapshot };
    },

    // A filed version of the app as a zip under one directory named after the project, which a
    // person's system opens without other tools; without a version, the current app. Installs,
    // builds and environment files are never filed or versioned.
    async appArchive(actor: Actor, projectId: string, version?: number) {
      await requireProject(actor, projectId, "read");
      let app;
      if (version === undefined) app = await currentApp(actor, projectId);
      else {
        const [latest] = (
          await listArtifacts(db, actor.tenantId, { kind: "app", limit: 1 })
        ).rows;
        const read =
          latest &&
          (await this.read(actor, projectId, {
            artifactId: latest.id,
            version,
          }));
        app = read && {
          name: `v${read.version}`,
          bundle: AppBundle.assert(JSON.parse(read.content)),
        };
      }
      if (!app) throw new ProjectError(404, "app_not_filed");
      const name = await archiveName(projectId);
      const zip = new JSZip();
      for (const [path, data] of Object.entries(bundleFiles(app.bundle)))
        if (isContainedPath(path)) zip.file(`${name}/${path}`, data);
      return {
        filename: `${name}-${app.name}.zip`,
        archive: await zip.generateAsync({
          type: "uint8array",
          compression: "DEFLATE",
        }),
      };
    },

    // The project as a zip of the chosen sections, always with project.json, the file import reads.
    async exportArchive(
      actor: Actor,
      projectId: string,
      sections: readonly ExportSection[],
    ) {
      const file = await this.export(actor, projectId);
      const name = await archiveName(projectId);
      const zip = new JSZip();
      zip.file("project.json", JSON.stringify(file, null, 2));
      const add = (
        directory: string,
        files: Iterable<[string, string | Uint8Array]>,
      ) => {
        for (const [path, data] of files)
          if (isContainedPath(path)) zip.file(`${directory}/${path}`, data);
      };
      const { rows } = await listArtifacts(db, actor.tenantId, {
        limit: MAX_LIST_LIMIT,
      });
      for (const artifact of rows) {
        if (!artifact.contentSha256 || artifact.kind === "app") continue;
        const section = exportSection(artifact.kind);
        if (!sections.includes(section)) continue;
        const stored = await getArtifactVersion(
          db,
          artifact.id,
          artifact.version,
        );
        if (!stored) continue;
        if (artifact.kind === MATERIAL_KIND) {
          if (!isContainedPath(stored.title)) continue;
          const data = /^data:[^;,]*;base64,(.*)$/s.exec(stored.content)?.[1];
          zip.file(
            `planning/materials/${stored.title}`,
            data === undefined ? stored.content : base64Decode(data),
          );
        } else if (section === "planning") {
          zip.file(`planning/${artifact.kind}.md`, stored.content);
        } else {
          const files = Object.entries(
            DesignBundle.assert(parseJson(stored.content)).files,
          );
          if (artifact.kind === "design") add("design", files);
          else if (isContainedPath(stored.title))
            add(`design/options/${stored.title}`, files);
        }
      }
      if (sections.includes(exportSection("app"))) {
        const app = await currentApp(actor, projectId);
        if (app) add("build", Object.entries(bundleFiles(app.bundle)));
      }
      return {
        filename: `${name}.zip`,
        archive: await zip.generateAsync({
          type: "uint8array",
          compression: "DEFLATE",
        }),
      };
    },

    // The import route calls this for each document its file marks approved,
    // right after writing it; the importing person is the approver.
    async recordImportApproval(
      actor: Actor,
      projectId: string,
      ref: ArtifactRef,
    ) {
      await requireProject(actor, projectId, "manage");
      const stored = await getArtifactVersion(db, ref.artifactId, ref.version);
      if (stored?.contentSha256 !== ref.sha256)
        throw new ProjectError(409, "artifact_ref_stale", {
          artifactId: ref.artifactId,
          version: ref.version,
        });
      await rawDB.insert(artifactImportApproval).values({
        ...ref,
        tenantId: actor.tenantId,
        projectId,
        principalId: actor.principalId,
      });
    },

    // The coordinator names the concept of a designer run it just deployed, before its assignment.
    async recordDesignConcept(actor: Actor, projectId: string, raw: unknown) {
      const input = DesignConceptRecord(raw);
      if (input instanceof type.errors)
        throw new ProjectError(400, "invalid_design_concept", {
          issues: input.summary,
        });
      await requireProject(actor, projectId, "manage");
      const [run] = await rawDB
        .select({ bundle: workflowRunLaunchSpec.frozenApprovalBundle })
        .from(workflowRun)
        .innerJoin(
          workflowRunLaunchSpec,
          eq(workflowRunLaunchSpec.anchorRunId, workflowRun.id),
        )
        .where(
          and(
            eq(workflowRun.id, input.runId),
            eq(workflowRun.tenantId, actor.tenantId),
          ),
        );
      if (!run || spawnedWorkflowRole(run.bundle) !== "designer")
        throw new ProjectError(404, "designer_run_not_found", {
          runId: input.runId,
        });
      try {
        await rawDB
          .insert(designConcept)
          .values({
            runId: input.runId,
            tenantId: actor.tenantId,
            projectId,
            ...input.concept,
          })
          .onConflictDoNothing();
      } catch (error) {
        // The coordinator's token only reads runs, so a designer left without its concept would
        // hold a slot as a waiting designer; the hub stops it and the original error stands.
        try {
          await cancelRun?.(
            actor.tenantId,
            input.runId,
            "design_concept_unrecorded",
          );
        } catch (cancelError) {
          log.warn("Stopping designer run {runId} without its concept failed", {
            runId: input.runId,
            ...requestErrorMetadata(cancelError),
          });
        }
        throw error;
      }
      const [stored] = await rawDB
        .select({
          projectId: designConcept.projectId,
          label: designConcept.label,
          direction: designConcept.direction,
        })
        .from(designConcept)
        .where(eq(designConcept.runId, input.runId));
      if (
        stored?.projectId !== projectId ||
        stored.label !== input.concept.label
      )
        throw new ProjectError(409, "design_concept_conflict", {
          runId: input.runId,
        });
      return {
        runId: input.runId,
        concept: { label: stored.label, direction: stored.direction },
      };
    },

    // Called by an asking tool after its native approval resolved. The hub
    // binds the newest approved row for that tool and records only the refs it
    // covers whose hashes match storage; an approval is recorded once, so a
    // later deploy under an "always" grant never extends it to newer versions.
    async recordApproval(
      actor: Actor,
      projectId: string,
      raw: unknown,
    ): Promise<ArtifactApprovalReceipt> {
      const input = ArtifactApprovalRecord(raw);
      if (input instanceof type.errors)
        throw new ProjectError(400, "invalid_artifact_approval", {
          issues: input.summary,
        });
      await requireProject(actor, projectId, "manage");
      const covers = APPROVAL_COVERS[input.tool]!;
      const artifacts: { ref: ArtifactRef; writtenAt: Date }[] = [];
      for (const ref of input.artifacts) {
        if (!covers(ref.kind)) continue;
        const row = await getArtifact(db, ref.artifactId);
        if (!row || row.tenantId !== actor.tenantId)
          throw new ProjectError(404, "artifact_not_found", {
            artifactId: ref.artifactId,
          });
        const stored = await getArtifactVersion(
          db,
          ref.artifactId,
          ref.version,
        );
        if (row.kind !== ref.kind || stored?.contentSha256 !== ref.sha256)
          throw new ProjectError(409, "artifact_ref_stale", {
            artifactId: ref.artifactId,
            version: ref.version,
          });
        const [newest] = (
          await listArtifactVersions(db, ref.artifactId, { limit: 1 })
        ).versions;
        if (newest?.version !== ref.version)
          throw new ProjectError(409, "artifact_ref_stale", {
            artifactId: ref.artifactId,
            version: ref.version,
          });
        artifacts.push({ ref, writtenAt: new Date(newest.createdAt) });
      }
      return rawDB.transaction(async (tx) => {
        const [granted] = await tx
          .select({
            id: approval.id,
            askedAt: approval.createdAt,
            askedKinds: sql<string | null>`${approval.toolArguments}->>'kinds'`,
          })
          .from(approval)
          .where(
            and(
              eq(approval.tenantId, actor.tenantId),
              eq(approval.status, "approved"),
              eq(sql`${approval.toolDefinition}->>'name'`, input.tool),
            ),
          )
          .orderBy(desc(approval.resolvedAt))
          .limit(1)
          .for("update");
        if (!granted)
          throw new ProjectError(409, "approval_not_resolved", {
            tool: input.tool,
          });
        // The person approved the kinds the ask named, never another one the caller lists.
        const asked: unknown = JSON.parse(granted.askedKinds ?? "[]");
        const unasked =
          input.tool === "request_approval" &&
          artifacts.find(
            ({ ref }) => !(Array.isArray(asked) && asked.includes(ref.kind)),
          )?.ref;
        if (unasked)
          throw new ProjectError(409, "approval_kind_mismatch", {
            kind: unasked.kind,
            approved: String(asked),
          });
        const [recorded] = await tx
          .select({ approvalId: artifactApproval.approvalId })
          .from(artifactApproval)
          .where(eq(artifactApproval.approvalId, granted.id))
          .limit(1);
        if (recorded || !artifacts.length)
          return { approvalId: granted.id, artifacts: [] };
        // A version written while the person was deciding is not one they saw.
        const changed = artifacts.find(
          ({ writtenAt }) => writtenAt > granted.askedAt,
        )?.ref;
        if (changed)
          throw new ProjectError(409, "artifact_changed_during_approval", {
            kind: changed.kind,
            version: changed.version,
          });
        const refs = artifacts.map(({ ref }) => ref);
        await tx.insert(artifactApproval).values(
          refs.map((ref) => ({
            approvalId: granted.id,
            tenantId: actor.tenantId,
            projectId,
            tool: input.tool,
            ...ref,
          })),
        );
        return { approvalId: granted.id, artifacts: refs };
      });
    },

    // The person's own choice among the filed design options, never the coordinator's: the option
    // at the version they saw is filed as the design, and they approve exactly that design version.
    async chooseDesign(
      actor: Actor,
      projectId: string,
      raw: unknown,
      mailRun: (runId: string, content: string) => Promise<void>,
    ): Promise<DesignChoiceReceipt> {
      const input = DesignChoice(raw);
      if (input instanceof type.errors)
        throw new ProjectError(400, "invalid_design_choice", {
          issues: input.summary,
        });
      await requireProject(actor, projectId, "manage");
      const [chooser] = await rawDB
        .select({ kind: principal.kind })
        .from(principal)
        .where(eq(principal.id, actor.principalId));
      if (chooser?.kind !== "user")
        throw new ProjectError(403, "design_choice_person_only");
      const option = await getArtifact(db, input.artifactId);
      if (
        !option ||
        option.tenantId !== actor.tenantId ||
        option.kind !== "design_option"
      )
        throw new ProjectError(404, "design_option_not_found", {
          artifactId: input.artifactId,
        });
      const [newest] = (await listArtifactVersions(db, option.id, { limit: 1 }))
        .versions;
      const stored = await getArtifactVersion(db, option.id, input.version);
      if (!stored || newest?.version !== input.version)
        throw new ProjectError(409, "artifact_ref_stale", {
          artifactId: input.artifactId,
          version: input.version,
        });
      const [existing] = (
        await listArtifacts(db, actor.tenantId, { kind: "design", limit: 1 })
      ).rows;
      const written = existing
        ? await writeArtifactVersion(db, {
            scope: actor,
            artifactId: existing.id,
            title: stored.title,
            content: stored.content,
          })
        : await db.transaction((tx) =>
            createArtifact(tx, {
              scope: actor,
              ownerPrincipalId: actor.principalId,
              kind: "design",
              title: stored.title,
              content: stored.content,
              source: { origin: "manual" },
            }),
          );
      const design: ArtifactRef = {
        artifactId: "artifactId" in written ? written.artifactId : written.id,
        kind: "design",
        version: written.version,
        sha256: written.contentSha256!,
      };
      await rawDB.insert(artifactImportApproval).values({
        ...design,
        tenantId: actor.tenantId,
        projectId,
        principalId: actor.principalId,
      });
      // The other concepts' designers would file options nobody compares and hold their slots.
      const others = await rawDB
        .select({ runId: designConcept.runId })
        .from(designConcept)
        .innerJoin(workflowRun, eq(workflowRun.id, designConcept.runId))
        .where(
          and(
            eq(designConcept.tenantId, actor.tenantId),
            eq(designConcept.projectId, projectId),
            ne(designConcept.label, stored.title),
            inArray(workflowRun.status, ["deployed", "running"]),
          ),
        );
      await Promise.allSettled(
        others.map(({ runId }) =>
          cancelRun?.(actor.tenantId, runId, "design_concept_not_picked"),
        ),
      );
      const coordinator = await activeCoordinator(projectId);
      if (coordinator)
        await mailRun(
          coordinator.runId,
          designChosenNote(stored.title, design.version),
        );
      return { design, concept: stored.title };
    },
  };
}
