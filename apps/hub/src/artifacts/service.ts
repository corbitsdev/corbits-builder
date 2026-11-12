import { stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { type } from "arktype";
import { and, desc, eq, inArray, ne, notInArray, sql } from "drizzle-orm";
import { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import {
  createArtifact,
  findOrVersionArtifact,
  getArtifact,
  getArtifactVersion,
  listArtifacts,
  listArtifactVersions,
  MAX_LIST_LIMIT,
  setArtifactArchived,
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
  isLiveWorkflowRunStatus,
  principal,
  workflowRun,
  workflowRunLaunchSpec,
} from "@intx/db/schema";
import {
  ArtifactApprovalRecord,
  AppBundle,
  AppVersionMetadata,
  DocumentContent,
  MAX_APPROVAL_PACKAGE_BYTES,
  MATERIAL_KIND,
  ArtifactKindWrite,
  DesignBundle,
  DesignChoice,
  DesignConceptRecord,
  DesignDraft,
  ArtifactRead,
  DesignTweaks,
  isDocumentKind,
  type AcceptanceChecklist,
  type AcceptedMaterials,
  type UserManual,
  type MaterialReceipt,
  MaterialRemovedReceipt,
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
  type ProjectRun,
  RunAction,
  type ArtifactRef,
  type AppSnapshotReceipt,
  type AppSnapshotState,
  type AppVersion,
  type AppVersionList,
} from "@corbits-builder/schemas/artifact";
import type { SpawnedRole } from "@corbits-builder/schemas/installed-workflows";
import type { Fact, Shown } from "@corbits-builder/plugin";
import { OpenQuestions } from "@corbits-builder/schemas/questions";
import {
  ApproachesMeta,
  approachesIssue,
} from "@corbits-builder/schemas/approaches";
import {
  type ExportSection,
  exportSection,
  type PlanChildWrite,
  type PlanStepWrite,
  ProjectExport,
  ProjectExportMaterial,
  type StoredPlan,
  type StoredPlanChild,
  type StoredPlanStep,
} from "@corbits-builder/schemas/project";
import JSZip from "jszip";
import {
  COMMAND_PROGRESS_FILE,
  CommandProgress,
  type AgentActivity,
  type ProjectActivity,
} from "@corbits-builder/schemas/activity";
import {
  artifactApproval,
  artifactImportApproval,
  designConcept,
  project,
  projectCoordinator,
  runAction,
  settingsRecord,
} from "../db/schema.ts";
import type { AgentActivityTracker } from "./activity.ts";
import type { Actor } from "../lib/actor.ts";
import { parseJson } from "../lib/json.ts";
import { authorizeProject } from "../projects/authorization.ts";
import {
  ProjectError,
  projectResource,
  typeIssues,
} from "../projects/errors.ts";
import {
  AppRepositoryError,
  readAppRepository,
} from "../projects/app-repository.ts";
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
  readUserManual,
  manualPictures,
  warmStepWorkspace,
} from "./design-draft.ts";
import type { LiveApps } from "../live-app/runner.ts";
import { appContent, bundleFiles } from "../builds/app-snapshot.ts";
import { MAX_DESIGN_BYTES } from "./design-tools.ts";
import { DESIGN_STYLES, setThemeTokens } from "./design-tweaks.ts";
import type { ProjectState } from "./project-values.ts";
import {
  coordinatorTweaksNote,
  designerTweaksNote,
} from "../config/design-tweaks.ts";
import { designChosenNote } from "../config/design.ts";
import { loadSettings } from "../settings/policy.ts";
import {
  agentDecidesApprovals,
  awaitingApproval,
  preferenceGuidance,
  resolvePreferences,
} from "../config/preferences.ts";
import { frozenModelChoice, workflowBindings } from "../config/models.ts";
import { modelDirectory } from "../settings/custom-providers.ts";
import { materialRemovedNote, materialsNote } from "../config/materials.ts";
import {
  STEP_NOT_ASK_FIRST_TEXT,
  STEP_REQUIRED_TEXT,
  stepAskFirstNote,
  stepDeclinedNote,
  stepGoAheadNote,
} from "../config/answers.ts";
import { servingOffering } from "../workflows/install-for-tenant.ts";
import {
  acceptedMaterials,
  mailAttachmentName,
  materialContent,
  materialMimeType,
} from "./materials.ts";
import {
  parseApprovalPackageBundle,
  readProjectPackageSource,
  validateApprovalPackage,
  verifySourcePin,
} from "./approval-package.ts";
import {
  createApprovalRoundService,
  createPgApprovalRoundStore,
} from "./approval-rounds.ts";
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
const RECENT_FAILURES = 5;
// How many of the coordinator's ended runs its runs list keeps, newest first.
const RECENT_RUNS = 10;
// A command's progress line older than this was left by a command that died; it is not shown.
const COMMAND_PROGRESS_STALE_MS = 5 * 60_000;
// A run held on an approval is mid-turn, so its activity reads as work; the pending record is what
// says it waits on the person. Otherwise it is at work or parked between turns, which is idle.
const inFlightState = (
  heldOnApproval: boolean,
  working: boolean | undefined,
): InFlightRun["state"] => {
  if (heldOnApproval) return "approval";
  return working ? "working" : "waiting";
};
// A plan step as stored, under the id it came with or a short new one, with the go-ahead, cancel
// and decline that marksOf says it keeps; only an optional step keeps a decline.
function savedPlanStep(
  step: PlanChildWrite,
  marksOf: (step: PlanChildWrite, id: string) => PlanChildWrite | undefined,
): StoredPlanChild {
  const id = step.id ?? newPlanStepId();
  const saved: StoredPlanChild = {
    id,
    title: step.title,
    plugin: step.plugin,
    action: step.action,
    input: step.input,
    askFirst: step.askFirst,
  };
  const marks = marksOf(step, id);
  // What a ready-made plan said of a step stays with it: a run's save of a stored step keeps it as
  // stored.
  const said = marks ?? step;
  if (said.optional) saved.optional = said.optional;
  if (said.approval) saved.approval = said.approval;
  if (marks?.goAhead) saved.goAhead = marks.goAhead;
  if (marks?.cancelled) saved.cancelled = marks.cancelled;
  if (marks?.declined && saved.optional) saved.declined = marks.declined;
  return saved;
}
// The plan's action steps, those its groups hold among them.
const planActionSteps = (steps: readonly StoredPlanStep[]) =>
  steps.flatMap((step) => ("steps" in step ? step.steps : [step]));
const newPlanStepId = () => crypto.randomUUID().slice(0, 12);
const RunError = type({ "+": "delete", message: "string", "code?": "string" });
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const isUuid = (value: string) => new RegExp("^" + UUID + "$", "i").test(value);
// The coder task names documents as id@version@sha256 tokens.
const PINNED_REF = new RegExp("^(" + UUID + ")@(\\d+)@([a-f0-9]{64})$", "i");

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

function validateArtifactWriteContent(
  input: typeof ArtifactKindWrite.infer,
): boolean {
  const bundled =
    input.kind === "design" ||
    input.kind === "design_option" ||
    input.kind === "app" ||
    input.kind === "approval_package";
  if (bundled && input.openQuestions)
    throw new ProjectError(400, "invalid_artifact_write", {
      issues: [
        {
          path: "openQuestions",
          message: `goes on documents; write this ${input.kind} without it`,
        },
      ],
    });
  if (input.approaches) {
    if (input.kind !== "approaches")
      throw new ProjectError(400, "invalid_artifact_write", {
        issues: [
          {
            path: "approaches",
            message: `goes on the approaches document; write this ${input.kind} without it`,
          },
        ],
      });
    const issue = approachesIssue(input.approaches);
    if (issue)
      throw new ProjectError(400, "invalid_artifact_write", {
        issues: [issue],
      });
  }
  if (
    input.kind === "design" ||
    input.kind === "design_option" ||
    input.kind === "app"
  ) {
    const bundle = (input.kind === "app" ? AppBundle : DesignBundle)(
      parseJson(input.content),
    );
    if (bundle instanceof type.errors)
      throw new ProjectError(400, "invalid_" + input.kind, {
        issues: typeIssues(bundle, "content"),
      });
  }
  // An app is as large as it is.
  if (input.kind === "approval_package") {
    const bytes = Buffer.byteLength(input.content);
    if (bytes > MAX_APPROVAL_PACKAGE_BYTES)
      throw new ProjectError(413, "approval_package_too_large", {
        bytes,
        limit: MAX_APPROVAL_PACKAGE_BYTES,
      });
    parseApprovalPackageBundle(input.content);
  } else if (input.kind !== "app") {
    const document = DocumentContent(input.content);
    if (document instanceof type.errors)
      throw new ProjectError(400, "invalid_artifact_write", {
        issues: typeIssues(document, "content"),
      });
  }
  return bundled;
}

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

// Every version of the artifact, newest first, read a page at a time.
async function* everyVersion(db: ArtifactDb, artifactId: string) {
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

/**
 * Whether the project's app has had its first build: a version filed after a coder's passing
 * check, where an import is recorded as one.
 */
export async function appBuilt(db: ArtifactDb, tenantId: string) {
  const [app] = (await listArtifacts(db, tenantId, { kind: "app", limit: 1 }))
    .rows;
  if (!app) return false;
  for await (const row of everyVersion(db, app.id)) {
    const recorded = AppVersionMetadata(row.metadata);
    if (!(recorded instanceof type.errors) && recorded.source === "check")
      return true;
  }
  return false;
}

// A project is its own tenant, so the library's tenant scope is the project
// scope. The hub adds project grants and the exact versions each resolved
// native deploy approval covered.
export function createArtifactService(
  rawDB: DB["db"],
  runs: WorkflowRunReader,
  repoStore: RepoStore,
  tracker?: AgentActivityTracker,
  sidecarDataDir?: string,
  liveApps?: LiveApps,
  cancelRun?: (
    tenantId: string,
    runId: string,
    reason: string,
  ) => Promise<unknown>,
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

  // The one write into the project's plain store of values, each replacing the one of its name.
  const storeValues = (projectId: string, values: Record<string, unknown>) =>
    rawDB
      .update(project)
      .set({
        values: sql`${project.values} || ${JSON.stringify(values)}::jsonb`,
      })
      .where(eq(project.id, projectId));

  // The role's runs, newest first, each with its warm step, the design concept it works on, if
  // any, whether it is live and when it ended: the live runs, or with ended, every run.
  async function roleRuns(actor: Actor, role: SpawnedRole, ended: boolean) {
    const runs = await rawDB
      .select({
        runId: workflowRun.id,
        address: workflowRun.address,
        bundle: workflowRunLaunchSpec.frozenApprovalBundle,
        concept: designConcept.label,
        status: workflowRun.status,
        endedAt: workflowRun.endedAt,
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
              live: isLiveWorkflowRunStatus(run.status),
              endedAt: run.endedAt,
            },
          ]
        : [];
    });
  }

  // The workspaces of the role's live runs that the hub deployed on its local sidecar, newest
  // first, each with the design concept its run works on, if any.
  async function liveWorkspaces(actor: Actor, role: SpawnedRole) {
    if (!sidecarDataDir) return [];
    return (await roleRuns(actor, role, false)).flatMap(
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
  // the workspace at any moment, so it never seeds the next coder or stands as the saved app of a
  // project whose app repository holds none.
  // Versions filed before sources were recorded came only from checks and imports.
  async function mainLineVersion(artifactId: string) {
    for await (const row of everyVersion(db, artifactId)) {
      const recorded = AppVersionMetadata(row.metadata);
      if (recorded instanceof type.errors || recorded.source !== "snapshot")
        return row;
    }
    return undefined;
  }

  // The work an app repository does for a project, its refusals logged with why and answered as
  // the hub's.
  async function inAppRepository<T>(projectId: string, work: Promise<T>) {
    try {
      return await work;
    } catch (error) {
      if (error instanceof AppRepositoryError) {
        const { status, code, cause } = error;
        log.error("Reading the app repository failed: {reason}", {
          projectId,
          reason: cause instanceof Error ? cause.message : String(cause),
          ...requestErrorMetadata(cause),
        });
        throw new ProjectError(status, code, {}, { cause });
      }
      throw error;
    }
  }

  // The project's main-line app version.
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
      sha256: stored.contentSha256,
      bundle: AppBundle.assert(JSON.parse(stored.content)),
    };
  }

  // The tip of the project's app repository's main.
  const repositoryMain = (actor: Actor, projectId: string) =>
    inAppRepository(
      projectId,
      readAppRepository(rawDB, repoStore, actor.tenantId, projectId),
    );

  // The project's saved app: the tip of its app repository's main, which every write of the app
  // lands on, or while main holds no app, as for a project from before app repositories, its
  // main-line version; undefined while there is none.
  async function savedApp(actor: Actor, projectId: string) {
    const main = await repositoryMain(actor, projectId);
    if (!main?.app) return filedApp(actor);
    return { commit: main.commit, bundle: main.app.bundle };
  }

  // The app a download or an export's build/ carries: the filed version named, else the saved app;
  // its bundle and the name of its version.
  async function appCopy(actor: Actor, projectId: string, version?: number) {
    if (version === undefined) {
      const saved = await savedApp(actor, projectId);
      if (!saved) return undefined;
      return "commit" in saved
        ? { name: saved.commit.slice(0, 7), bundle: saved.bundle }
        : { name: `v${saved.version}`, bundle: saved.bundle };
    }
    const [latest] = (
      await listArtifacts(db, actor.tenantId, { kind: "app", limit: 1 })
    ).rows;
    const stored = latest && (await getArtifactVersion(db, latest.id, version));
    if (!latest || !stored?.contentSha256)
      throw new ProjectError(404, "app_not_filed", { version });
    return {
      name: `v${version}`,
      bundle: AppBundle.assert(parseJson(stored.content)),
    };
  }

  // The project's current files: a coder's workspace while it builds, read where it lies, else
  // the saved app; undefined while the project has no app files at all.
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
    const saved = await savedApp(actor, projectId);
    if (!saved) return undefined;
    const login = demoLogin(saved.bundle.files);
    return {
      key: "commit" in saved ? saved.commit : saved.sha256,
      source: saved.bundle,
      shown: {
        ...("commit" in saved
          ? ({ source: "repository", commit: saved.commit } as const)
          : ({ source: "filed", version: saved.version } as const)),
        ...(login ? { demoLogin: login } : {}),
      },
    };
  }

  // The project's current files to run, or the app's state when there are none to run.
  async function runnableApp(actor: Actor, projectId: string) {
    await requireProject(actor, projectId, "read");
    if (!liveApps) throw new ProjectError(503, "live_app_unavailable");
    const current = await appSource(actor, projectId);
    if (current) return current;
    liveApps.runner.stop(projectId);
    return { state: "not_built" } as const;
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
    // With every port of a configured range in use, the app runs but cannot be shown.
    try {
      return {
        state: "running",
        ...shown,
        url: proxy.expose({ tenantId: routeTenantId, projectId }, run.url),
      };
    } catch (error) {
      log.warn("Exposing the live app failed", requestErrorMetadata(error));
      return {
        state: "failed",
        error: error instanceof Error ? error.message : String(error),
        ...shown,
      };
    }
  }

  // The filed design a concept's look lives in, at its latest version, with the look the person
  // saved: its option, titled with its label, or without a concept the design itself. Its files are
  // read only when asked for.
  async function filedDesign(actor: Actor, concept: string | undefined) {
    const kind = concept === undefined ? "design" : "design_option";
    const [filed] = (
      await listArtifacts(db, actor.tenantId, { kind, limit: MAX_LIST_LIMIT })
    ).rows.filter(
      (row) =>
        row.contentSha256 && (concept === undefined || row.title === concept),
    );
    if (!filed) return undefined;
    return {
      artifactId: filed.id,
      version: filed.version,
      kind,
      title: filed.title,
      async files() {
        const stored = await getArtifactVersion(db, filed.id, filed.version);
        if (!stored) throw new ProjectError(409, "invalid_design");
        const bundle = DesignBundle(parseJson(stored.content));
        if (bundle instanceof type.errors)
          throw new ProjectError(409, "invalid_design", { issues: bundle });
        return bundle.files;
      },
    };
  }

  // The draft the newest designer run of the concept, other than skip, left in its workspace, read
  // with read: while the run is live, or once it ended unless the concept's design was filed since,
  // for the person may have saved a look on it. Undefined when the filed design stands instead.
  async function standingDesignDraft(
    actor: Actor,
    concept: string | undefined,
    read: (workspace: string) => Promise<Record<string, string> | undefined>,
    skip?: string,
  ) {
    const [newest] = (await roleRuns(actor, "designer", true)).filter(
      (run) => run.runId !== skip && (run.concept ?? undefined) === concept,
    );
    if (!newest || !sidecarDataDir || newest.address === null) return undefined;
    const left = await read(
      warmStepWorkspace(sidecarDataDir, newest.address, newest.stepId),
    );
    if (left === undefined || newest.live) return left;
    const filed = await filedDesign(actor, concept);
    if (!filed) return left;
    const { endedAt } = newest;
    return endedAt &&
      Date.parse(await filedAt(filed.artifactId, filed.version)) <=
        endedAt.getTime()
      ? left
      : undefined;
  }

  function designDraftOf(files: Record<string, string>) {
    const draft = DesignDraft.assert({ files });
    if (Buffer.byteLength(JSON.stringify(draft)) > MAX_DESIGN_BYTES)
      throw new ProjectError(409, "design_draft_too_large");
    return draft;
  }

  // A chosen design option's content is filed as the design, approved by actor as the chooser: the
  // person, or the designer's run when approvals are left to Builder. The other concepts' designers
  // would file options nobody compares and hold their slots, so they stop.
  async function fileChosenDesign(
    actor: Actor,
    projectId: string,
    concept: string,
    content: string,
  ): Promise<ArtifactRef> {
    const [existing] = (
      await listArtifacts(db, actor.tenantId, { kind: "design", limit: 1 })
    ).rows;
    const written = existing
      ? await writeArtifactVersion(db, {
          scope: actor,
          artifactId: existing.id,
          title: concept,
          content,
        })
      : await db.transaction((tx) =>
          createArtifact(tx, {
            scope: actor,
            ownerPrincipalId: actor.principalId,
            kind: "design",
            title: concept,
            content,
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
    const others = await rawDB
      .select({ runId: designConcept.runId })
      .from(designConcept)
      .innerJoin(workflowRun, eq(workflowRun.id, designConcept.runId))
      .where(
        and(
          eq(designConcept.tenantId, actor.tenantId),
          eq(designConcept.projectId, projectId),
          ne(designConcept.label, concept),
          inArray(workflowRun.status, ["deployed", "running"]),
        ),
      );
    await Promise.allSettled(
      others.map(({ runId }) =>
        cancelRun?.(actor.tenantId, runId, "design_concept_not_picked"),
      ),
    );
    return design;
  }

  // With approvals left to Builder nobody is asked to pick a design, so a concept's option is chosen
  // as it is filed, its designer's run recorded as the chooser. Whether the write was so chosen.
  async function chosenByBuilder(
    actor: Actor,
    projectId: string,
    written: { kind: string; content: string },
    concept: string | undefined,
  ) {
    if (written.kind !== "design_option" || !concept) return false;
    const settings = await loadSettings(rawDB, actor.tenantId, projectId);
    if (!agentDecidesApprovals(settings.preferences.value)) return false;
    await fileChosenDesign(actor, projectId, concept, written.content);
    return true;
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
      const heldOnApproval = new Set(
        (
          await rawDB
            .select({ runId: approval.anchorRunId })
            .from(approval)
            .where(
              and(
                eq(approval.tenantId, actor.tenantId),
                eq(approval.status, "pending"),
              ),
            )
        ).map((row) => row.runId),
      );
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
            state: inFlightState(heldOnApproval.has(run.runId), seen?.working),
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
        // When the person recorded it; an approval given through a deploy's ask has no such record.
        const [record] =
          approved === undefined
            ? []
            : await rawDB
                .select({ at: artifactImportApproval.createdAt })
                .from(artifactImportApproval)
                .where(
                  and(
                    eq(artifactImportApproval.artifactId, row.id),
                    eq(artifactImportApproval.version, approved),
                  ),
                );
        const openQuestionCount = openQuestionsOf(row.metadata).length;
        artifacts.push({
          artifactId: row.id,
          kind: row.kind,
          title: row.title,
          version: row.version,
          sha256: row.contentSha256,
          filedAt: await filedAt(row.id, row.version),
          ...(approved === undefined ? {} : { approvedVersion: approved }),
          ...(record === undefined
            ? {}
            : { approvedAt: record.at.toISOString() }),
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
        appBuilt: await appBuilt(db, actor.tenantId),
        preferences,
        preferenceGuidance: preferenceGuidance(preferences, "coordinator"),
      };
    },

    // Any agent is at work only inside a message run; a parked specialist's run stays deployed
    // or running between turns.
    async activity(actor: Actor, projectId: string): Promise<ProjectActivity> {
      await requireProject(actor, projectId, "read");
      // What a long command the run executes last said about itself, from the file the sandbox
      // keeps beside the workspace on this machine's sidecar. A command that died leaves its file
      // behind, so a stale line is not shown.
      const commandProgress = async (
        address: string | null,
        bundle: unknown,
      ): Promise<CommandProgress | undefined> => {
        if (!sidecarDataDir || address === null) return undefined;
        const step = spawnedWorkflowStep(bundle);
        if (!step) return undefined;
        const file = join(
          dirname(warmStepWorkspace(sidecarDataDir, address, step.stepId)),
          COMMAND_PROGRESS_FILE,
        );
        // No file is the usual case: nothing long is running. A file caught mid-write reads as
        // broken JSON for a moment and is read again on the next poll.
        let raw: unknown;
        try {
          raw = await Bun.file(file).json();
        } catch (error) {
          if (hasCode(error) && error.code === "ENOENT") return undefined;
          if (error instanceof SyntaxError) return undefined;
          throw error;
        }
        const progress = CommandProgress(raw);
        if (progress instanceof type.errors) return undefined;
        if (Date.now() - Date.parse(progress.at) > COMMAND_PROGRESS_STALE_MS)
          return undefined;
        return progress;
      };
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
          address: workflowRun.address,
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
        // A specialist between turns is not at work; only a turn in progress is work,
        // timed from that turn's start rather than the run's deploy.
        if (!shown?.working || !shown.since) continue;
        const command = await commandProgress(run.address, run.bundle);
        agents.push({
          runId: run.runId,
          role,
          since: shown.since,
          tools: shown.tools,
          ...(shown.said ? { said: shown.said } : {}),
          ...(command ? { command } : {}),
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
            // Older hubs expired an ask when an upgrade withdrew it; the next coordinator asked again.
            notInArray(approval.status, ["pending", "expired"]),
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

    // The draft a design dispatched again continues from instead of starting over: the one an
    // earlier designer run of the calling run's concept left, else the filed design.
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
      const left = await standingDesignDraft(
        actor,
        concept,
        readDesignBundle,
        self.runId,
      );
      if (left !== undefined) return designDraftOf(left);
      const filed = await filedDesign(actor, concept);
      if (filed) return designDraftOf(await filed.files());
      throw new ProjectError(404, "design_draft_not_found");
    },

    // Without a concept, the draft of the designer working on the design itself.
    async designDraft(
      actor: Actor,
      projectId: string,
      concept?: string,
    ): Promise<DesignDraft> {
      await requireProject(actor, projectId, "read");
      const files = await standingDesignDraft(actor, concept, readDesignDraft);
      if (files === undefined)
        throw new ProjectError(404, "design_draft_not_found");
      return designDraftOf(files);
    },

    // The ready-made plans the project is following.
    async projectFollowing(actor: Actor, projectId: string) {
      await requireProject(actor, projectId, "read");
      const [row] = await rawDB
        .select({ following: project.following })
        .from(project)
        .where(eq(project.id, projectId));
      return row?.following ?? [];
    },

    async setFollowing(
      actor: Actor,
      projectId: string,
      handles: readonly string[],
    ) {
      await requireProject(actor, projectId, "manage");
      const followed = [...new Set(handles)];
      await rawDB
        .update(project)
        .set({ following: followed })
        .where(eq(project.id, projectId));
      return followed;
    },

    // The plan's steps as stored; where each stands is worked out when it is read.
    async projectPlan(
      actor: Actor,
      projectId: string,
    ): Promise<{ steps: StoredPlanStep[]; updatedAt: string | null }> {
      await requireProject(actor, projectId, "read");
      const [row] = await rawDB
        .select({ plan: project.plan })
        .from(project)
        .where(eq(project.id, projectId));
      return row?.plan ?? { steps: [], updatedAt: null };
    },

    // Replaces the plan with steps already checked against the catalog. Only a person gives a step
    // its go-ahead or cancels it, so a run's save keeps the marks stored under each step's id.
    async savePlan(
      actor: Actor,
      projectId: string,
      steps: readonly PlanStepWrite[],
    ): Promise<StoredPlan> {
      await requireProject(actor, projectId, "manage");
      const [caller] = await rawDB
        .select({ kind: principal.kind })
        .from(principal)
        .where(eq(principal.id, actor.principalId));
      const [row] = await rawDB
        .select({ plan: project.plan })
        .from(project)
        .where(eq(project.id, projectId));
      const before = new Map(
        planActionSteps(row?.plan?.steps ?? []).map((step) => [step.id, step]),
      );
      const marksOf = (step: PlanChildWrite, id: string) =>
        caller?.kind === "user" ? step : before.get(id);
      const saved = steps.map((step): StoredPlanStep => {
        if (!("steps" in step)) return savedPlanStep(step, marksOf);
        return {
          id: step.id ?? newPlanStepId(),
          title: step.title,
          steps: step.steps.map((child) => savedPlanStep(child, marksOf)),
        };
      });
      const ids = saved.flatMap((step) => [
        step.id,
        ...("steps" in step ? step.steps : []).map(({ id }) => id),
      ]);
      const repeated = ids.find((id, at) => ids.indexOf(id) !== at);
      if (repeated !== undefined)
        throw new ProjectError(400, "repeated_plan_step", { id: repeated });
      // The person's no is remembered on the plan, so only they can take a declined step out of it.
      const dropped = [...before.values()].find(
        (step) => step.declined && !ids.includes(step.id),
      );
      if (caller?.kind !== "user" && dropped)
        throw new ProjectError(409, "declined_plan_step_removed", {
          id: dropped.id,
          text: `The person declined "${dropped.title}", so it stays in the plan; leave it there and carry on with the rest.`,
        });
      const plan = { steps: saved, updatedAt: new Date().toISOString() };
      await rawDB
        .update(project)
        .set({ plan })
        .where(eq(project.id, projectId));
      return plan;
    },

    // The person declines an optional plan step, or restores one, and the coordinator is told. Only a
    // person may, and never on a step its ready-made plan requires.
    async declinePlanStep(
      actor: Actor,
      projectId: string,
      stepId: string,
      change: {
        declined: boolean;
        mailRun: (runId: string, content: string) => Promise<void>;
      },
    ) {
      await requireProject(actor, projectId, "manage");
      const [caller] = await rawDB
        .select({ kind: principal.kind })
        .from(principal)
        .where(eq(principal.id, actor.principalId));
      if (caller?.kind !== "user")
        throw new ProjectError(403, "only_a_person_declines");
      const [row] = await rawDB
        .select({ plan: project.plan })
        .from(project)
        .where(eq(project.id, projectId));
      const plan = row?.plan;
      const step = planActionSteps(plan?.steps ?? []).find(
        ({ id }) => id === stepId,
      );
      if (!plan || !step)
        throw new ProjectError(404, "plan_step_not_found", { id: stepId });
      if (!step.optional)
        throw new ProjectError(409, "plan_step_required", {
          id: stepId,
          text: STEP_REQUIRED_TEXT,
        });
      if (change.declined === (step.declined !== undefined)) return plan;
      if (change.declined)
        step.declined = { by: actor.principalId, at: new Date().toISOString() };
      else delete step.declined;
      plan.updatedAt = new Date().toISOString();
      await rawDB
        .update(project)
        .set({ plan })
        .where(eq(project.id, projectId));
      const coordinator = await activeCoordinator(projectId);
      if (coordinator)
        await change.mailRun(
          coordinator.runId,
          stepDeclinedNote(step.title, change.declined),
        );
      return plan;
    },

    // The person gives the go-ahead on a step they asked to be consulted on, or turns "ask me
    // first" on or off for a step, and the coordinator is told. Only a person may.
    async askPlanStep(
      actor: Actor,
      projectId: string,
      stepId: string,
      change: {
        ask: { goAhead: true } | { askFirst: boolean };
        mailRun: (runId: string, content: string) => Promise<void>;
      },
    ) {
      await requireProject(actor, projectId, "manage");
      const [caller] = await rawDB
        .select({ kind: principal.kind })
        .from(principal)
        .where(eq(principal.id, actor.principalId));
      if (caller?.kind !== "user")
        throw new ProjectError(403, "only_a_person_decides");
      const [row] = await rawDB
        .select({ plan: project.plan })
        .from(project)
        .where(eq(project.id, projectId));
      const plan = row?.plan;
      const step = planActionSteps(plan?.steps ?? []).find(
        ({ id }) => id === stepId,
      );
      if (!plan || !step)
        throw new ProjectError(404, "plan_step_not_found", { id: stepId });
      let note: string;
      if ("goAhead" in change.ask) {
        if (!step.askFirst)
          throw new ProjectError(409, "plan_step_not_ask_first", {
            id: stepId,
            text: STEP_NOT_ASK_FIRST_TEXT,
          });
        step.goAhead = { by: actor.principalId, at: new Date().toISOString() };
        note = stepGoAheadNote(step.title);
      } else {
        if (change.ask.askFirst === step.askFirst) return plan;
        step.askFirst = change.ask.askFirst;
        if (step.askFirst) delete step.goAhead;
        note = stepAskFirstNote(step.title, step.askFirst);
      }
      plan.updatedAt = new Date().toISOString();
      await rawDB
        .update(project)
        .set({ plan })
        .where(eq(project.id, projectId));
      const coordinator = await activeCoordinator(projectId);
      if (coordinator) await change.mailRun(coordinator.runId, note);
      return plan;
    },

    // Records the plugin action the coordinator just started a specialist run for, before the
    // run's assignment reaches it.
    async recordRunAction(actor: Actor, projectId: string, raw: unknown) {
      const input = RunAction(raw);
      if (input instanceof type.errors)
        throw new ProjectError(400, "invalid_run_action", { issues: input });
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
      if (!run || !spawnedWorkflowRole(run.bundle))
        throw new ProjectError(404, "specialist_run_not_found", {
          runId: input.runId,
        });
      await rawDB
        .insert(runAction)
        .values({
          runId: input.runId,
          tenantId: actor.tenantId,
          projectId,
          plugin: input.plugin,
          action: input.action,
          planStep: input.step ?? null,
        })
        .onConflictDoNothing();
      return input;
    },

    // The runs the coordinator started in the project: every one still at work, and the latest
    // that ended.
    async runs(actor: Actor, projectId: string): Promise<ProjectRun[]> {
      await requireProject(actor, projectId, "read");
      const rows = await rawDB
        .select({
          runId: runAction.runId,
          plugin: runAction.plugin,
          action: runAction.action,
          step: runAction.planStep,
          concept: designConcept.label,
          status: workflowRun.status,
          address: workflowRun.address,
          startedAt: workflowRun.createdAt,
          endedAt: workflowRun.endedAt,
          failureCode: workflowRun.failureCode,
          failureMessage: workflowRun.failureMessage,
        })
        .from(runAction)
        .innerJoin(workflowRun, eq(workflowRun.id, runAction.runId))
        .leftJoin(designConcept, eq(designConcept.runId, runAction.runId))
        .where(
          and(
            eq(runAction.tenantId, actor.tenantId),
            eq(runAction.projectId, projectId),
          ),
        )
        .orderBy(desc(workflowRun.createdAt))
        .limit(RECENT_RUNS * 4);
      const heldOnApproval = new Set(
        (
          await rawDB
            .select({ runId: approval.anchorRunId })
            .from(approval)
            .where(
              and(
                eq(approval.tenantId, actor.tenantId),
                eq(approval.status, "pending"),
              ),
            )
        ).map((row) => row.runId),
      );
      let ended = 0;
      const listed: ProjectRun[] = [];
      for (const row of rows) {
        const live = row.status === "deployed" || row.status === "running";
        if (!live) ended += 1;
        if (!live && ended > RECENT_RUNS) continue;
        const progress = tracker?.progress(row.runId);
        // The latest call with what it was given, as far as its turn's calls are kept.
        const latest = tracker?.of(row.runId).tools.at(-1);
        let lastActivity = progress?.recent.at(-1);
        if (latest) lastActivity = latest.name;
        if (latest?.subject) lastActivity = `${latest.name} ${latest.subject}`;
        const error =
          row.status === "failed" ? await runFailure(runs, row) : undefined;
        const run: ProjectRun = {
          runId: row.runId,
          plugin: row.plugin,
          action: row.action,
          status: row.status,
          startedAt: row.startedAt.toISOString(),
        };
        if (row.step !== null) run.step = row.step;
        if (row.concept !== null) run.concept = row.concept;
        if (live)
          run.state = inFlightState(
            heldOnApproval.has(row.runId),
            tracker?.of(row.runId)?.working,
          );
        // The hub has seen nothing of a run that has not begun its first turn.
        if (live && run.state === "waiting" && !progress)
          run.state = "starting";
        if (row.endedAt) run.endedAt = row.endedAt.toISOString();
        if (lastActivity) run.lastActivity = lastActivity;
        if (progress) run.lastActivityAt = progress.lastActivityAt;
        if (error) run.error = error.message;
        listed.push(run);
      }
      return listed;
    },

    // Stops a run the coordinator started in the project, through Interchange's own cancellation.
    async stopRun(actor: Actor, projectId: string, runId: string) {
      await requireProject(actor, projectId, "manage");
      const [run] = await rawDB
        .select({ status: workflowRun.status })
        .from(runAction)
        .innerJoin(workflowRun, eq(workflowRun.id, runAction.runId))
        .where(
          and(
            eq(runAction.runId, runId),
            eq(runAction.tenantId, actor.tenantId),
            eq(runAction.projectId, projectId),
          ),
        );
      if (!run) throw new ProjectError(404, "run_not_found", { runId });
      if (!isLiveWorkflowRunStatus(run.status))
        throw new ProjectError(409, "run_ended", { runId, status: run.status });
      if (!cancelRun) throw new ProjectError(503, "run_stop_unavailable");
      await cancelRun(actor.tenantId, runId, "stopped_by_coordinator");
      return { runId };
    },

    // Saves values for the calling specialist run: only those the plugin action it was started for
    // writes. A run holds no project write of its own; this is its one way to save a value.
    async saveRunValues(
      actor: Actor,
      projectId: string,
      values: Record<string, unknown>,
      writes: (run: { plugin: string; action: string }) => readonly string[],
    ) {
      await requireProject(actor, projectId, "read");
      const [run] = await rawDB
        .select({ plugin: runAction.plugin, action: runAction.action })
        .from(runAction)
        .innerJoin(principal, eq(principal.refId, runAction.runId))
        .where(
          and(
            eq(principal.id, actor.principalId),
            eq(principal.kind, "workflow"),
            eq(runAction.tenantId, actor.tenantId),
            eq(runAction.projectId, projectId),
          ),
        );
      if (!run)
        throw new ProjectError(403, "run_saves_no_values", {
          hint: "This run was not started for a plugin action that saves project values, so it saves none.",
        });
      const allowed = writes(run);
      const refused = Object.keys(values).filter(
        (name) => !allowed.includes(name),
      );
      if (refused.length > 0)
        throw new ProjectError(403, "run_value_not_written", {
          issues: refused.map((name) => ({
            path: name,
            message: `is not a value ${run.plugin} ${run.action} saves; it saves ${allowed.length > 0 ? allowed.join(", ") : "none"}`,
          })),
        });
      await storeValues(projectId, values);
    },

    // What project values are read from: the filed design at its latest version, with the look
    // the person saved, the project's plain store, and the files attached, which a file value names.
    async projectState(actor: Actor, projectId: string): Promise<ProjectState> {
      await requireProject(actor, projectId, "read");
      const [row] = await rawDB
        .select({ values: project.values })
        .from(project)
        .where(eq(project.id, projectId));
      const filed = await filedDesign(actor, undefined);
      const { rows: materials } = await listArtifacts(db, actor.tenantId, {
        kind: MATERIAL_KIND,
        limit: MAX_LIST_LIMIT,
      });
      return {
        styles: filed && (await filed.files())[DESIGN_STYLES],
        stored: row?.values ?? {},
        materials: materials.map((material) => ({
          artifactId: material.id,
          name: material.title,
        })),
      };
    },

    // Merges values into the project's plain store, each replacing the one of its name.
    async saveStoredValues(
      actor: Actor,
      projectId: string,
      values: Record<string, unknown>,
    ) {
      await requireProject(actor, projectId, "manage");
      await storeValues(projectId, values);
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
          issues: input,
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
      const filed = await filedDesign(actor, input.concept);
      if (!filed && designerRunId === undefined)
        throw new ProjectError(404, "design_not_found");
      if (filed) {
        const bundle = await filed.files();
        const files = {
          ...bundle,
          [DESIGN_STYLES]: setThemeTokens(bundle[DESIGN_STYLES] ?? "", tokens),
        };
        const written = await writeArtifactVersion(db, {
          scope: actor,
          artifactId: filed.artifactId,
          title: filed.title,
          content: JSON.stringify({ files }),
        });
        artifact = {
          artifactId: written.artifactId,
          kind: filed.kind,
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
        inputs.map((input) => ({
          name: mailAttachmentName(input.name),
          mimeType: input.mimeType,
          data: base64Encode(input.data),
        })),
      );
      return { materials };
    },

    // A material the person takes back: the coordinator, when one runs, is told first, so a note
    // that cannot be sent leaves the material in place for another try; then it is archived, so
    // every list leaves it out while its versions stay.
    async removeMaterial(
      actor: Actor,
      projectId: string,
      artifactId: string,
      mailRun: (runId: string, content: string) => Promise<void>,
    ): Promise<MaterialRemovedReceipt> {
      const allowed = await requireProject(actor, projectId, "manage");
      if (!(await allowed(artifactResource(MATERIAL_KIND), "write")))
        throw new ProjectError(403, "artifact_write_refused", {
          kind: MATERIAL_KIND,
        });
      const row = await getArtifact(db, artifactId);
      if (!row || row.tenantId !== actor.tenantId || row.kind !== MATERIAL_KIND)
        throw new ProjectError(404, "material_not_found", { artifactId });
      if (row.archivedAt !== null)
        return { artifactId: row.id, title: row.title, told: false };
      const coordinator = await activeCoordinator(projectId);
      if (coordinator)
        await mailRun(coordinator.runId, materialRemovedNote(row.title));
      await setArtifactArchived(db, row, true);
      return {
        artifactId: row.id,
        title: row.title,
        told: coordinator !== null,
      };
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
          issues: material,
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

    // The project's saved app, never a coder's work in progress: the commit at the tip of its app
    // repository's main, or its main-line filed version; undefined while it has none.
    async savedApp(actor: Actor, projectId: string) {
      await requireProject(actor, projectId, "read");
      return savedApp(actor, projectId);
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
      // Once the coder ends, the checklist is the one saved with the app.
      const saved = await savedApp(actor, projectId);
      const markdown = saved?.bundle.files["ACCEPTANCE.md"];
      if (markdown !== undefined) return { markdown };
      throw new ProjectError(404, "acceptance_not_found");
    },

    // The user manual as the coder keeps it, with the pictures check-app saved; once the coder
    // ends, the one saved with the app, whose pictures the bundle carries as binaries.
    async manual(actor: Actor, projectId: string): Promise<UserManual> {
      await requireProject(actor, projectId, "read");
      for (const { dir } of await liveWorkspaces(actor, "coder")) {
        const manual = await readUserManual(dir);
        if (manual !== undefined) return manual;
      }
      const saved = await savedApp(actor, projectId);
      const markdown = saved?.bundle.files["docs/USER-MANUAL.md"];
      if (saved !== undefined && markdown !== undefined)
        return {
          markdown,
          pictures: manualPictures(markdown, (ref) => {
            const data = saved.bundle.binary?.[`docs/${ref}`];
            return data === undefined ? undefined : Buffer.from(data, "base64");
          }),
        };
      throw new ProjectError(404, "manual_not_found");
    },

    async read(
      actor: Actor,
      projectId: string,
      raw: unknown,
    ): Promise<ArtifactContent> {
      const input = ArtifactRead(raw);
      if (input instanceof type.errors)
        throw new ProjectError(400, "invalid_artifact_read", {
          issues: input,
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
      if (!row || row.tenantId !== actor.tenantId || row.archivedAt !== null)
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
    ): Promise<{ artifact: ArtifactRef; designChosen?: true }> {
      const input = ArtifactKindWrite(raw);
      if (input instanceof type.errors)
        throw new ProjectError(400, "invalid_artifact_write", {
          issues: input,
        });
      const bundled = validateArtifactWriteContent(input);
      const allowed = await requireProject(actor, projectId, "read");
      if (!(await allowed(artifactResource(input.kind), "write")))
        throw new ProjectError(403, "artifact_write_refused", {
          kind: input.kind,
        });
      const [active] = await rawDB
        .select({ kind: principal.kind, refId: principal.refId })
        .from(principal)
        .where(eq(principal.id, actor.principalId));
      if (input.kind === "approval_package") {
        const settings = await loadSettings(rawDB, actor.tenantId, projectId);
        const preferences = resolvePreferences(settings.preferences.value);
        let sealed:
          | {
              audience: string;
              decisionNeeded?: string;
              sources: {
                artifactId: string;
                kind: string;
                version: number;
                sha256: string;
              }[];
            }
          | undefined;
        if (active?.kind === "workflow" && active.refId) {
          const [row] = await rawDB
            .select({ fields: settingsRecord.fields })
            .from(settingsRecord)
            .where(
              and(
                eq(settingsRecord.tenantId, actor.tenantId),
                eq(settingsRecord.scopeKey, `presenter:${active.refId}`),
              ),
            );
          const rawAssignment =
            row && typeof row.fields === "object" && row.fields !== null
              ? (row.fields as unknown as Record<string, unknown>)["assignment"]
              : undefined;
          if (
            typeof rawAssignment === "object" &&
            rawAssignment !== null &&
            "audience" in rawAssignment &&
            typeof rawAssignment.audience === "string" &&
            "sources" in rawAssignment &&
            Array.isArray(rawAssignment.sources)
          ) {
            sealed = {
              audience: rawAssignment.audience,
              ...("decisionNeeded" in rawAssignment &&
              typeof rawAssignment.decisionNeeded === "string"
                ? { decisionNeeded: rawAssignment.decisionNeeded }
                : {}),
              sources: rawAssignment.sources as {
                artifactId: string;
                kind: string;
                version: number;
                sha256: string;
              }[],
            };
          } else {
            throw new ProjectError(
              403,
              "approval_package_assignment_mismatch",
              { runId: active.refId },
            );
          }
        }
        await validateApprovalPackage(
          input.content,
          readProjectPackageSource(
            db,
            actor.tenantId,
            async (artifactId, kind, version) => {
              if (kind !== "design" && agentDecidesApprovals(preferences))
                return true;
              return (
                (await approvedVersion(actor.tenantId, artifactId)) === version
              );
            },
          ),
          sealed,
        );
      }
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
      // designer never files the design itself: the person's pick among the options does, or Builder's
      // when the person handed approvals over.
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
      let artifact: ArtifactRef;
      if (existing) {
        const written = await writeArtifactVersion(db, {
          scope: actor,
          artifactId: existing.id,
          title,
          content: input.content,
          ...(metadata ? { metadata } : {}),
        });
        artifact = {
          artifactId: written.artifactId,
          kind: input.kind,
          version: written.version,
          sha256: written.contentSha256!,
        };
      } else {
        const created = await db.transaction((tx) =>
          createArtifact(tx, {
            scope: actor,
            ownerPrincipalId: actor.principalId,
            kind: input.kind,
            title,
            content: input.content,
            source: {
              origin: active?.kind === "user" ? "manual" : "workflow",
            },
            ...(metadata ? { metadata } : {}),
          }),
        );
        artifact = {
          artifactId: created.id,
          kind: created.kind,
          version: created.version,
          sha256: created.contentSha256!,
        };
      }
      if (await chosenByBuilder(actor, projectId, input, concept))
        return { artifact, designChosen: true };
      return { artifact };
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
      const content = await appContent(workspace.dir);
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
      for await (const row of everyVersion(db, app.id)) {
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
      const app = await appCopy(actor, projectId, version);
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

    // The project as a zip of the chosen sections, always with project.json, the file import reads;
    // build/ is the filed app version named, else the saved app.
    async exportArchive(
      actor: Actor,
      projectId: string,
      sections: readonly ExportSection[],
      appVersion?: number,
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
        const app = await appCopy(actor, projectId, appVersion);
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

    // A person's answer to a screen approves what it was shown: a document at that version, or a
    // design option, which is chosen as the design. Each must make one of the facts the question
    // allows and still be the newest version, or nothing is recorded.
    async approveShown(
      actor: Actor,
      projectId: string,
      shown: readonly Shown[],
      allowed: readonly Fact[],
      mailRun: (runId: string, content: string) => Promise<void>,
    ) {
      await requireProject(actor, projectId, "manage");
      const [approver] = await rawDB
        .select({ kind: principal.kind })
        .from(principal)
        .where(eq(principal.id, actor.principalId));
      if (approver?.kind !== "user")
        throw new ProjectError(403, "approval_person_only");
      const approvals: ArtifactRef[] = [];
      for (const { artifactId, version } of shown) {
        const row = await getArtifact(db, artifactId);
        if (!row || row.tenantId !== actor.tenantId)
          throw new ProjectError(404, "artifact_not_found", { artifactId });
        let fact: Fact | undefined;
        if (row.kind === "design_option") fact = "design_chosen";
        else if (isDocumentKind(row.kind)) fact = `approved:${row.kind}`;
        if (fact === undefined || !allowed.includes(fact))
          throw new ProjectError(409, "approval_not_asked", {
            kind: row.kind,
            allowed: allowed.join(", "),
          });
        const [newest] = (
          await listArtifactVersions(db, artifactId, { limit: 1 })
        ).versions;
        const stored = await getArtifactVersion(db, artifactId, version);
        if (!stored?.contentSha256 || newest?.version !== version)
          throw new ProjectError(409, "artifact_ref_stale", {
            artifactId,
            version,
          });
        approvals.push({
          artifactId,
          kind: row.kind,
          version,
          sha256: stored.contentSha256,
        });
      }
      for (const ref of approvals) {
        if (ref.kind === "design_option")
          await this.chooseDesign(
            actor,
            projectId,
            { artifactId: ref.artifactId, version: ref.version },
            mailRun,
          );
        else if (
          (await approvedVersion(actor.tenantId, ref.artifactId)) !==
          ref.version
        )
          await this.recordImportApproval(actor, projectId, ref);
      }
    },

    // The import route calls this for each document its file marks approved, and a screen's
    // answer for each document it approves; the person is the approver.
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

    // A plugin's starter names the concept of a run it just deployed, before its assignment.
    async recordDesignConcept(actor: Actor, projectId: string, raw: unknown) {
      const input = DesignConceptRecord(raw);
      if (input instanceof type.errors)
        throw new ProjectError(400, "invalid_design_concept", {
          issues: input,
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
      if (!run || spawnedWorkflowRole(run.bundle) === undefined)
        throw new ProjectError(404, "spawned_run_not_found", {
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

    async recordPresenterAssignment(
      actor: Actor,
      projectId: string,
      raw: unknown,
    ) {
      const PresenterAssignmentRecord = type({
        "+": "ignore",
        runId: "string > 0",
        assignment: {
          "+": "ignore",
          audience: "string > 0",
          decisionNeeded: "string > 0",
          "tone?": "string",
          "length?": "string",
          sources: type({
            "+": "ignore",
            artifactId: "string > 0",
            kind: "string > 0",
            title: "string > 0",
            version: "number.integer > 0",
            sha256: /^[a-f0-9]{64}$/,
          })
            .array()
            .atLeastLength(1),
        },
      });
      const input = PresenterAssignmentRecord(raw);
      if (input instanceof type.errors)
        throw new ProjectError(400, "invalid_presenter_assignment", {
          issues: input.summary,
        });
      await requireProject(actor, projectId, "manage");
      const settings = await loadSettings(rawDB, actor.tenantId, projectId);
      const preferences = resolvePreferences(settings.preferences.value);
      const readSource = readProjectPackageSource(
        db,
        actor.tenantId,
        async (artifactId, kind, version) => {
          if (kind !== "design" && agentDecidesApprovals(preferences))
            return true;
          return (
            (await approvedVersion(actor.tenantId, artifactId)) === version
          );
        },
      );
      for (const source of input.assignment.sources)
        await verifySourcePin(source, readSource, "assignment.sources");
      const sealedAssignment = {
        ...input.assignment,
        sealed: true as const,
      };
      await rawDB
        .insert(settingsRecord)
        .values({
          tenantId: actor.tenantId,
          scopeKey: `presenter:${input.runId}`,
          projectId,
          fields: {
            assignment: sealedAssignment,
          } as unknown as typeof settingsRecord.$inferInsert.fields,
        })
        .onConflictDoUpdate({
          target: [settingsRecord.tenantId, settingsRecord.scopeKey],
          set: {
            fields: {
              assignment: sealedAssignment,
            } as unknown as typeof settingsRecord.$inferInsert.fields,
          },
        });
      return { runId: input.runId, assignment: sealedAssignment };
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
          issues: input,
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
          issues: input,
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
      const design = await fileChosenDesign(
        actor,
        projectId,
        stored.title,
        stored.content,
      );
      const coordinator = await activeCoordinator(projectId);
      if (coordinator)
        await mailRun(
          coordinator.runId,
          designChosenNote(stored.title, design.version),
        );
      return { design, concept: stored.title };
    },

    approvalRounds: createApprovalRoundService(
      createPgApprovalRoundStore(rawDB),
    ),
  };
}
