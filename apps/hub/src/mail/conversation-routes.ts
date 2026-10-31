import { and, asc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { describeRoute, resolver } from "hono-openapi";
import { type } from "arktype";
import { type DB } from "@intx/db";
import { workflowRun } from "@intx/db/schema";
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
} from "@corbits-builder/schemas/conversation";
import { project, projectCoordinator } from "../db/schema.ts";
import { reportAuthorization } from "../projects/authorization.ts";
import { ProjectError, projectResource } from "../projects/errors.ts";
import { getLogger } from "@intx/log";
import { requestErrorMetadata } from "../request-error.ts";
import { parseJson } from "../lib/json.ts";
import {
  createCoordinatorQuestionProseReader,
  type CoordinatorRepoDirSource,
} from "./coordinator-question.ts";
import { isRecord, projectRunTurns } from "./conversation-turns.ts";

const log = getLogger(["corbits-builder", "hub", "conversation"]);

// Delegate to the mounted native events route so workflow grants and committed
// history have one authority.
export function createConversationRoutes(
  db: DB["db"],
  dispatch: (request: Request) => Response | Promise<Response>,
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
        "Read the current registered coordinator's committed native runtime events. These events are not a rendered conversation transcript by themselves. When present, turns are the person's thread across every coordinator run of the project, in timestamp order: person and coordinator text from the committed durable conversation mirror, plus participant mail from other workflow runs on a retained mail thread that includes a person. threads are the retained native mail threads among workflow runs only, keyed by References root. A still-open input park also carries the coordinator's asking prose when the run's committed durable conversation mirror provides it (body.question, sourced from the coordinator's turn); parks without real prose stay verbatim. Native workflow read authority is required in addition to project read.",
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
        409: { description: "Coordinator not registered or unavailable" },
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
          const run = runs.find((candidate) => candidate.active);
          if (!run || run.run.anchorRunId !== run.run.id || !run.run.address)
            return null;
          // A resumed project runs on a new coordinator; earlier runs keep
          // the conversation that came before it.
          const prior = runs.flatMap((candidate) =>
            candidate.active || !candidate.run.address
              ? []
              : [{ runId: candidate.run.id, address: candidate.run.address }],
          );
          return { runId: run.run.id, address: run.run.address, prior };
        });
        if (!selected) throw new ProjectError(409, "coordinator_unavailable");
        const target = new URL(c.req.url);
        target.pathname =
          "/api/tenants/" +
          encodeURIComponent(tenantId) +
          "/workflows/runs/" +
          encodeURIComponent(selected.runId) +
          "/events";
        // Product query parameters must not steer the native target.
        target.search = "";
        const response = await dispatch(new Request(target.href, c.req.raw));
        response.headers.set("cache-control", "no-store");
        if (!response.ok || options?.repoStore === undefined) return response;
        // The input park carries no wording; when the durable conversation
        // mirror provides asking prose, it rides the pending park. A missing
        // mirror is an empty turn list, not a failed read.
        try {
          const raw = await response.text();
          const passThrough = (body: string) =>
            new Response(body, {
              status: response.status,
              headers: response.headers,
            });
          const payload = parseJson(raw);
          if (payload === undefined) return passThrough(raw);
          const { address } = selected;
          const events = (payload as { events?: unknown })["events"];
          if (Array.isArray(events)) {
            const readProse = createCoordinatorQuestionProseReader({
              repoStore: options.repoStore,
            });
            const park = latestPendingInputPark(events);
            if (park !== undefined) {
              const question = await readProse({ address, park });
              if (question !== undefined) park["question"] = question;
            }
          }
          if (isRecord(payload)) {
            const { repoStore, mailDirectory } = options;
            const read = (run: { runId: string; address: string }) =>
              projectRunTurns({
                db,
                tenantId,
                repoStore,
                mailDirectory,
                ...run,
              });
            const current = await read({ runId: selected.runId, address });
            const turns = [...current.turns];
            for (const run of selected.prior)
              turns.push(...(await read(run)).turns);
            turns.sort((left, right) => left.at - right.at);
            if (current.threads !== undefined)
              payload["threads"] = current.threads;
            payload["turns"] = turns.slice(-maxConversationTurns);
          }
          return passThrough(JSON.stringify(payload));
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

/**
 * The open question's park: the latest `SignalAwaited` input park that no
 * later `SignalReceived` has released. Released parks keep their verbatim
 * bodies, so wording is attributed only to the question the coordinator is
 * waiting on.
 */
function latestPendingInputPark(
  events: unknown[],
): Record<string, unknown> | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (typeof event !== "object" || event === null) continue;
    const { type, body } = event as { type?: unknown; body?: unknown };
    if (type !== "SignalAwaited" || typeof body !== "object" || body === null)
      continue;
    const park = body as Record<string, unknown>;
    if (park["parkKind"] !== "input") continue;
    const released = events
      .slice(index + 1)
      .some(
        (later) =>
          typeof later === "object" &&
          later !== null &&
          (later as { type?: unknown }).type === "SignalReceived",
      );
    if (!released) return park;
  }
  return undefined;
}
