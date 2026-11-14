import { and, desc, eq, inArray } from "drizzle-orm";
import { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type { Hono } from "hono";
import { describeRoute, resolver } from "hono-openapi";
import { listArtifacts, type ArtifactDb } from "@corbits/artifacts";
import type { DB } from "@intx/db";
import {
  approval,
  isLiveWorkflowRunStatus,
  liveWorkflowRunStatuses,
  workflowRun,
  workflowRunLaunchSpec,
} from "@intx/db/schema";
import type { TenantEnv } from "@intx/hub-api";
import { getLogger } from "@intx/log";
import {
  WORKFLOW_RUN_REF,
  workflowRunRepoIdForAddress,
  type WorkflowRunReader,
} from "@intx/hub-sessions";
import type { WorkflowRole } from "@corbits-builder/schemas/installed-workflows";
import {
  LiveRunStates,
  ProjectStatus,
  type ProjectAppStatus,
  type ProjectWorker,
  type RunState,
} from "@corbits-builder/schemas/project-status";
import { projectStatusWording as text } from "../config/project-status.ts";
import type { Actor } from "../lib/actor.ts";
import type { LiveApps } from "../live-app/runner.ts";
import { errorCode, requestErrorMetadata } from "../request-error.ts";
import { actorOf, authorizeProject } from "./authorization.ts";
import { workflowRoleSql } from "../workflows/spawn-role.ts";

const LIVE = [...liveWorkflowRunStatuses];
const log = getLogger(["corbits-builder", "hub", "next-step"]);
// The web client polls run states every few seconds, so a run whose state cannot be read is logged
// once per this interval rather than on every poll.
const UNREADABLE_LOG_MS = 5 * 60 * 1000;

type ProjectRun = {
  runId: string;
  role: WorkflowRole;
  status: string;
  address: string | null;
  createdAt: Date;
  failureMessage: string | null;
};

// Runs are newest first. A failure stands on the newest run of a role, and the
// first such specialist in that order is the one the next step already names.
function newestFailedSpecialist(
  runs: readonly ProjectRun[],
): ProjectRun | undefined {
  const newest = new Map<WorkflowRole, ProjectRun>();
  for (const run of runs) if (!newest.has(run.role)) newest.set(run.role, run);
  return [...newest.values()].find(
    (run) => run.role !== "coordinator" && run.status === "failed",
  );
}

/**
 * Where the project stands and the person's one next step, from native state only: run status,
 * each live run's latest committed event, pending approval records of live runs, the hub's live
 * app and the latest filed app version. Never from model text.
 */
export function createProjectNextStep(
  db: DB["db"],
  runs: WorkflowRunReader,
  liveApps?: LiveApps,
) {
  if (!(db instanceof PostgresJsDatabase))
    throw new Error("Next step requires postgres-js");
  const artifactDb: ArtifactDb = db;
  const unreadableLogged = new Map<string, number>();

  const readableProject = (actor: Actor, projectId: string) =>
    authorizeProject(db, actor, projectId, "read");

  // Every run of the project with its role, newest first; the role is read in SQL so the frozen
  // bundles stay in the database.
  async function projectRuns(
    actor: Actor,
    liveOnly = false,
  ): Promise<ProjectRun[]> {
    const rows = await db
      .select({
        runId: workflowRun.id,
        status: workflowRun.status,
        address: workflowRun.address,
        createdAt: workflowRun.createdAt,
        failureMessage: workflowRun.failureMessage,
        role: workflowRoleSql(workflowRunLaunchSpec.frozenApprovalBundle),
      })
      .from(workflowRun)
      .innerJoin(
        workflowRunLaunchSpec,
        eq(workflowRunLaunchSpec.anchorRunId, workflowRun.id),
      )
      .where(
        and(
          eq(workflowRun.tenantId, actor.tenantId),
          liveOnly ? inArray(workflowRun.status, LIVE) : undefined,
        ),
      )
      .orderBy(desc(workflowRun.createdAt));
    return rows.flatMap(({ role, ...run }) => (role ? [{ ...run, role }] : []));
  }

  async function latestEvent(run: ProjectRun) {
    const { events } = await runs.readLatestRunEvents(
      workflowRunRepoIdForAddress(run.address!),
      WORKFLOW_RUN_REF,
      (id) => id === run.runId,
    );
    return events.get(run.runId) ?? null;
  }

  // Every turn ends parked on input, so a run whose latest event is that park is idle.
  async function runState(run: ProjectRun): Promise<RunState> {
    if (run.address === null) return "starting";
    try {
      const event = await latestEvent(run);
      unreadableLogged.delete(run.runId);
      if (event === null) return "starting";
      if (event.type !== "SignalAwaited") return "working";
      const kind = event.body["parkKind"];
      if (kind === "input" || kind === "signal-relay") return "idle";
      return kind === "question" ? "question" : "approval";
    } catch (error) {
      logUnreadable(run, error);
      return "unknown";
    }
  }

  function logUnreadable(run: ProjectRun, error: unknown) {
    const now = Date.now();
    if (now - (unreadableLogged.get(run.runId) ?? 0) < UNREADABLE_LOG_MS)
      return;
    unreadableLogged.set(run.runId, now);
    log.error("Reading a run's latest event failed", {
      runId: run.runId,
      ...errorCode(error),
      ...requestErrorMetadata(error),
    });
  }

  // A failed run's own failure message stands in for an event that cannot be read.
  async function failureEvent(run: ProjectRun) {
    if (run.address === null) return null;
    try {
      return await latestEvent(run);
    } catch (error) {
      logUnreadable(run, error);
      return null;
    }
  }

  async function failureReason(run: ProjectRun) {
    const event = await failureEvent(run);
    const error = event?.body["error"];
    const message =
      typeof error === "object" && error !== null && "message" in error
        ? error.message
        : undefined;
    if (typeof message === "string" && message !== "") return message;
    return run.failureMessage ?? undefined;
  }

  function appStatus(
    projectId: string,
    hasSource: boolean,
    savedVersion: number | undefined,
  ): ProjectAppStatus {
    const saved = savedVersion === undefined ? {} : { savedVersion };
    if (!liveApps) return { state: "unavailable", ...saved };
    const host = liveApps.runner.state(projectId);
    if (host === undefined)
      return { state: hasSource ? "stopped" : "not_started", ...saved };
    if (host.state === "failed")
      return {
        state: "failed",
        ...(host.error ? { reason: host.error } : {}),
        ...saved,
      };
    return { state: host.state, ...saved };
  }

  async function liveStates(all: ProjectRun[]) {
    const live = all.filter((run) => isLiveWorkflowRunStatus(run.status));
    return Promise.all(
      live.map(async (run) => ({
        runId: run.runId,
        role: run.role,
        state: await runState(run),
      })),
    );
  }

  return {
    async runStates(actor: Actor, projectId: string): Promise<LiveRunStates> {
      await readableProject(actor, projectId);
      return { runs: await liveStates(await projectRuns(actor, true)) };
    },

    async status(actor: Actor, projectId: string): Promise<ProjectStatus> {
      const { status } = await readableProject(actor, projectId);
      const all = await projectRuns(actor);
      const failed = newestFailedSpecialist(all);
      const note = (body: ProjectStatus): ProjectStatus =>
        failed === undefined
          ? body
          : { ...body, failedSpecialist: failed.role };
      const states = await liveStates(all);
      const pending = await db
        .select({
          id: approval.id,
          tool: approval.toolDefinition,
          args: approval.toolArguments,
        })
        .from(approval)
        .innerJoin(workflowRun, eq(workflowRun.id, approval.anchorRunId))
        .where(
          and(
            eq(approval.tenantId, actor.tenantId),
            eq(approval.status, "pending"),
            inArray(workflowRun.status, LIVE),
          ),
        )
        .orderBy(approval.createdAt);
      const [filed] = (
        await listArtifacts(artifactDb, actor.tenantId, {
          kind: "app",
          limit: 1,
        })
      ).rows;
      const coderRan = all.some((run) => run.role === "coder");
      const coderLive = states.some((run) => run.role === "coder");
      const app = appStatus(
        projectId,
        coderLive || filed !== undefined,
        filed?.version,
      );

      const working: ProjectWorker[] = states.flatMap(({ role, state }) =>
        state === "working" || state === "starting" || state === "unknown"
          ? [{ role, state }]
          : [],
      );
      const busy = working
        .filter((item) => item.state === "working")
        .map((item) => item.role);
      const starting = working
        .filter((item) => item.state === "starting")
        .map((item) => item.role);
      const unknown = working.find((item) => item.state === "unknown");
      const who = unknown
        ? text.unknown(unknown.role)
        : [
            ...(busy.length > 0 || starting.length === 0
              ? [text.working(busy)]
              : []),
            ...starting.map(text.starting),
          ].join(" ");
      const appState =
        app.state === "failed"
          ? text.app.failed(app.reason)
          : text.app[app.state];
      const appNow =
        app.state === "not_started" || app.state === "unavailable"
          ? appState
          : `${appState} ${text.saved(app.savedVersion)}`;
      const now = (lead: string) => `${lead} ${appNow}`;

      if (status === "archived")
        return note({
          working,
          now: now(text.archived),
          app,
          next: { text: text.next.archived },
        });
      const asked = pending[0];
      if (asked) {
        const name = (asked.tool as { name?: unknown } | null)?.name;
        const tool =
          typeof name === "string" && name !== "" ? name : "approval";
        const kinds = (asked.args as { kinds?: unknown } | null)?.kinds;
        return note({
          working,
          now: now(who),
          waiting: { kind: "approval", approvalId: asked.id, tool },
          app,
          next: {
            text: text.approval(
              tool,
              Array.isArray(kinds)
                ? kinds.filter((kind) => typeof kind === "string")
                : [],
            ),
          },
        });
      }
      if (!states.some((run) => run.role === "coordinator"))
        return note({
          working,
          now: now(text.stopped("coordinator", undefined)),
          app,
          next: {
            text: text.next.resumeCoordinator,
            action: "resume_coordinator",
          },
        });
      const waitOn = busy[0] ?? starting[0];
      if (waitOn !== undefined)
        return note({
          working,
          now: now(who),
          app,
          next: { text: text.next.wait(waitOn) },
        });
      if (unknown)
        return note({
          working,
          now: now(who),
          app,
          next: { text: text.next.unknown },
        });
      if (failed)
        return note({
          working,
          now: now(text.stopped(failed.role, await failureReason(failed))),
          app,
          next: { text: text.next.retry, action: "reply" },
        });
      if (coderRan && app.state === "failed")
        return note({
          working,
          now: now(who),
          app,
          next: { text: text.next.fixApp, action: "reply" },
        });
      if (coderRan && app.state === "running")
        return note({
          working,
          now: now(who),
          app,
          next: { text: text.next.tryApp, action: "open_app" },
        });
      if (coderRan && app.state === "starting")
        return note({
          working,
          now: now(who),
          app,
          next: { text: text.next.waitApp },
        });
      return note({
        working,
        now: now(who),
        waiting: { kind: "reply" },
        app,
        next: { text: text.next.reply, action: "reply" },
      });
    },
  };
}

export function mountProjectNextStepRoutes(
  app: Hono<TenantEnv>,
  nextStep: ReturnType<typeof createProjectNextStep>,
) {
  const security = [{ sessionCookie: [] }, { deviceBearer: [] }];
  const refused = {
    403: { description: "Project read refused" },
    404: { description: "Project not found in tenant" },
  };
  app.get(
    "/:projectId/next-step",
    describeRoute({
      tags: ["Projects"],
      operationId: "readProjectNextStep",
      description:
        "Who is at work in the project, what waits on the person, the app's state and the person's one next step, derived only from native state: run status and each live run's latest committed event (a run parked on input is idle), pending approval records of live runs, the hub's live app and the latest filed app version. failedSpecialist is the specialist whose newest run failed, when one has. Never from model text.",
      security,
      responses: {
        200: {
          description: "The project's current state and next step",
          content: { "application/json": { schema: resolver(ProjectStatus) } },
        },
        ...refused,
      },
    }),
    async (c) => {
      return c.json(
        await nextStep.status(actorOf(c), c.req.param("projectId")),
      );
    },
  );
  app.get(
    "/:projectId/run-states",
    describeRoute({
      tags: ["Projects"],
      operationId: "readProjectRunStates",
      description:
        "Each live run of the project and its state from its latest committed event: working, idle (parked on input), approval (parked on an approval), question (parked on a question to the person), starting (no event yet) or unknown (its history could not be read).",
      security,
      responses: {
        200: {
          description: "The project's live runs and their states",
          content: { "application/json": { schema: resolver(LiveRunStates) } },
        },
        ...refused,
      },
    }),
    async (c) => {
      return c.json(
        await nextStep.runStates(actorOf(c), c.req.param("projectId")),
      );
    },
  );
}
