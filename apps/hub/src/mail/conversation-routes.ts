import { and, asc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { describeRoute, resolver } from "hono-openapi";
import { type } from "arktype";
import { type DB } from "@intx/db";
import { workflowRun } from "@intx/db/schema";
import { type WorkflowRunReader } from "@intx/hub-sessions";
import {
  createResolveTenant,
  requireAuth,
  type TenantEnv,
} from "@intx/hub-api";
import { resolveProjectTenant } from "../projects/authorization.ts";
import { ProjectId } from "@corbits-builder/schemas/project";
import {
  ConversationEvents,
  maxConversationTurns,
  coordinatorQuestions,
} from "@corbits-builder/schemas/conversation";
import { project, projectCoordinator } from "../db/schema.ts";
import { reportAuthorization } from "../projects/authorization.ts";
import { ProjectError, projectResource } from "../projects/errors.ts";
import { getLogger } from "@intx/log";
import { requestErrorMetadata } from "../request-error.ts";
import { earlierRunQuestions } from "./earlier-questions.ts";
import {
  type CoordinatorRepoDirSource,
  isRecord,
  projectRunTurns,
  unsavedPersonTurns,
} from "./conversation-turns.ts";

const log = getLogger(["corbits-builder", "hub", "conversation"]);

// Delegate to the mounted native events route so workflow grants and committed
// history have one authority.
export function createConversationRoutes(
  db: DB["db"],
  dispatch: (request: Request) => Response | Promise<Response>,
  runReader: WorkflowRunReader,
  options?: {
    repoStore?: CoordinatorRepoDirSource;
    /** The retained native mail store the hub archives workflow mail into. */
    mailDirectory?: string;
  },
) {
  const app = new Hono<TenantEnv>();
  app.get(
    "/:projectId/conversation/events",
    requireAuth,
    createResolveTenant({ db }),
    resolveProjectTenant(db),
    async (c, next) => {
      c.header("cache-control", "no-store");
      await next();
    },
    describeRoute({
      operationId: "readProjectConversationEvents",
      tags: ["Conversation"],
      description:
        "Read the current registered coordinator's committed native runtime events. While no coordinator is registered (one is starting or replacing another), runId is null, events and questions are empty and turns still carry the conversation of the project's earlier coordinator runs. These events are not a rendered conversation transcript by themselves. When present, turns are the person's thread across every coordinator run of the project, in timestamp order: person and coordinator text from the committed durable conversation mirror, plus participant mail from other workflow runs on a retained mail thread that includes a person. threads are the retained native mail threads among workflow runs only, keyed by References root. questions are the project's questions to the person, oldest first, each with a status. Native workflow read authority is required in addition to project read.",
      security: [{ sessionCookie: [] }, { deviceBearer: [] }],
      parameters: ["tenantId", "projectId"].map((name) => ({
        name,
        in: "path" as const,
        required: true,
        schema: { type: "string" as const },
      })),
      responses: {
        200: {
          description: "Native committed run events",
          content: {
            "application/json": { schema: resolver(ConversationEvents) },
          },
        },
        400: { description: "Invalid project" },
        401: { description: "Authentication required" },
        403: {
          description: "User, project or native workflow authority refused",
        },
        404: { description: "Project or native run unavailable" },
        503: { description: "Native event history unavailable" },
      },
    }),
    async (c) => {
      try {
        const actor = c.get("principal");
        if (actor.kind !== "user")
          throw new ProjectError(403, "conversation_requires_user");
        const projectId = ProjectId(c.req.param("projectId"));
        if (projectId instanceof type.errors)
          throw new ProjectError(400, "invalid_project_id");
        const tenantId = c.get("tenant").id;
        const allowed = await reportAuthorization(db, {
          tenantId,
          principalId: actor.id,
        });
        if (!(await allowed(projectResource(projectId), "read")))
          throw new ProjectError(403, "forbidden");
        const selected = await db.transaction(async (tx) => {
          // Serialize selection with registration, then release the DB
          // connection before dispatch invokes the native route's DB work.
          const [parent] = await tx
            .select({ id: project.id })
            .from(project)
            .where(
              and(eq(project.id, projectId), eq(project.tenantId, tenantId)),
            )
            .for("share");
          if (!parent) throw new ProjectError(404, "project_not_found");
          const runs = await tx
            .select({ run: workflowRun, active: projectCoordinator.active })
            .from(projectCoordinator)
            .innerJoin(
              workflowRun,
              eq(workflowRun.id, projectCoordinator.runId),
            )
            .where(
              and(
                eq(projectCoordinator.projectId, projectId),
                eq(workflowRun.tenantId, tenantId),
              ),
            )
            .orderBy(asc(projectCoordinator.createdAt));
          const found = runs.find((candidate) => candidate.active);
          const run =
            found && found.run.anchorRunId === found.run.id && found.run.address
              ? { runId: found.run.id, address: found.run.address }
              : undefined;
          // A resumed project runs on a new coordinator; earlier runs keep
          // the conversation that came before it.
          const prior = runs.flatMap((candidate) =>
            candidate === found || !candidate.run.address
              ? []
              : [{ runId: candidate.run.id, address: candidate.run.address }],
          );
          return { run, prior };
        });
        const repoStore = options?.repoStore;
        const mailDirectory = options?.mailDirectory;
        const read = (
          store: CoordinatorRepoDirSource,
          run: { runId: string; address: string },
        ) =>
          projectRunTurns({
            db,
            tenantId,
            repoStore: store,
            mailDirectory,
            ...run,
          });
        const priorTurns = async (store: CoordinatorRepoDirSource) =>
          (
            await Promise.all(selected.prior.map((run) => read(store, run)))
          ).flatMap((prior) => prior.turns);
        // Between one coordinator and the next (an upgrade hands off, a reopened project starts
        // one) the person still reads what was said; only the live run's events wait for a bind.
        if (selected.run === undefined) {
          // Without the mirror store there are no turns to read, as for a bound coordinator.
          if (repoStore === undefined)
            return c.json({
              runId: null,
              events: [],
              questions: await earlierRunQuestions(runReader, selected.prior),
            });
          let turns;
          let questions;
          try {
            const earlier = earlierRunQuestions(runReader, selected.prior);
            turns = (await priorTurns(repoStore)).sort(
              (left, right) => left.at - right.at,
            );
            questions = await earlier;
          } catch (error) {
            log.error(
              "Conversation projection failed",
              requestErrorMetadata(error),
            );
            throw new ProjectError(
              503,
              "conversation_projection_failed",
              {},
              { cause: error },
            );
          }
          return c.json({
            runId: null,
            events: [],
            turns: turns.slice(-maxConversationTurns),
            questions,
          });
        }
        const current = selected.run;
        const target = new URL(c.req.url);
        target.pathname =
          "/api/tenants/" +
          encodeURIComponent(tenantId) +
          "/workflows/runs/" +
          encodeURIComponent(current.runId) +
          "/events";
        // Product query parameters must not steer the native target.
        target.search = "";
        const response = await dispatch(new Request(target.href, c.req.raw));
        response.headers.set("cache-control", "no-store");
        if (!response.ok) return response;
        try {
          const payload: unknown = JSON.parse(await response.text());
          if (!isRecord(payload))
            throw new Error("Native run events are not a JSON object");
          const events = ConversationEvents.get("events").assert(
            payload["events"],
          );
          const earlier = earlierRunQuestions(runReader, selected.prior);
          if (repoStore !== undefined) {
            const live = await read(repoStore, current);
            const turns = [
              ...live.turns,
              ...unsavedPersonTurns(events, live.turns),
              ...(await priorTurns(repoStore)),
            ];
            turns.sort((left, right) => left.at - right.at);
            if (live.threads !== undefined) payload["threads"] = live.threads;
            payload["turns"] = turns.slice(-maxConversationTurns);
          }
          payload["questions"] = [
            ...(await earlier),
            ...coordinatorQuestions(events, true),
          ];
          return new Response(JSON.stringify(payload), {
            status: response.status,
            headers: response.headers,
          });
        } catch (error) {
          log.error(
            "Conversation projection failed",
            requestErrorMetadata(error),
          );
          throw new ProjectError(
            503,
            "conversation_projection_failed",
            {},
            { cause: error },
          );
        }
      } catch (error) {
        if (error instanceof ProjectError)
          return c.json({ code: error.code, ...error.details }, error.status);
        throw error;
      }
    },
  );
  return app;
}
