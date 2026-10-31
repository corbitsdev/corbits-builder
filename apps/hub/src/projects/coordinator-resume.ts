import { and, asc, eq, ne } from "drizzle-orm";
import type { MiddlewareHandler } from "hono";
import type { DB } from "@intx/db";
import { workflowRun, workflowRunDispatch } from "@intx/db/schema";
import type { WorkflowRunReader } from "@intx/hub-sessions";
import { createArtifactService } from "../artifacts/service.ts";
import { resumeContext, resumeMessage } from "../config/resume.ts";
import { projectCoordinator } from "../db/schema.ts";
import { readDurableConversationTurns } from "../mail/conversation-turns.ts";
import type { CoordinatorRepoDirSource } from "../mail/coordinator-question.ts";
import { awaitingApproval } from "@corbits-builder/tools-handoff";
import { agentDecidesApprovals } from "../config/preferences.ts";
import { getLogger } from "@intx/log";
import { requestErrorMetadata } from "../request-error.ts";
import { readJson } from "../lib/json.ts";

const log = getLogger(["corbits-builder", "hub", "coordinator-resume"]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Every mail to an unbounded run is a dispatched turn, so the hub mails nothing when it starts a
 * resumed project's coordinator. Until that run's first mail, the project's earlier coordinator
 * runs and its filed documents are the held context, delivered inside that first mail.
 */
export function createCoordinatorResumeContext(deps: {
  db: DB["db"];
  runs: WorkflowRunReader;
  repoStore: CoordinatorRepoDirSource;
}): MiddlewareHandler {
  const { db } = deps;
  const artifacts = createArtifactService(db, deps.runs);

  async function heldContext(tenantId: string, runId: string) {
    const [bound] = await db
      .select({
        projectId: projectCoordinator.projectId,
        principalId: projectCoordinator.registeredBy,
      })
      .from(projectCoordinator)
      .innerJoin(workflowRun, eq(workflowRun.id, projectCoordinator.runId))
      .where(
        and(
          eq(projectCoordinator.runId, runId),
          eq(projectCoordinator.active, true),
          eq(workflowRun.tenantId, tenantId),
        ),
      );
    if (!bound) return undefined;
    const [mailed] = await db
      .select({ id: workflowRunDispatch.id })
      .from(workflowRunDispatch)
      .where(
        and(
          eq(workflowRunDispatch.anchorRunId, runId),
          eq(workflowRunDispatch.kind, "mail"),
        ),
      )
      .limit(1);
    if (mailed) return undefined;
    const prior = await db
      .select({ address: workflowRun.address })
      .from(projectCoordinator)
      .innerJoin(workflowRun, eq(workflowRun.id, projectCoordinator.runId))
      .where(
        and(
          eq(projectCoordinator.projectId, bound.projectId),
          ne(projectCoordinator.runId, runId),
        ),
      )
      .orderBy(asc(projectCoordinator.createdAt));
    if (prior.length === 0) return undefined;
    const turns = [];
    for (const { address } of prior)
      if (address)
        turns.push(
          ...(await readDurableConversationTurns({
            repoStore: deps.repoStore,
            address,
          })),
        );
    turns.sort((left, right) => left.at - right.at);
    const actor = { tenantId, principalId: bound.principalId };
    const { artifacts: filed, preferences } = await artifacts.list(
      actor,
      bound.projectId,
    );
    return resumeContext({
      turns,
      awaiting: awaitingApproval(filed, agentDecidesApprovals(preferences)).map(
        (artifact) => artifact.title,
      ),
      withApp: filed.some((artifact) => artifact.kind === "app"),
    });
  }

  return async (c, next) => {
    const tenantId = c.req.param("tenantId");
    const runId = c.req.param("runId");
    if (c.req.method !== "POST" || !tenantId || !runId) return next();
    // A context that cannot be read must not cost the person their message.
    let context: Awaited<ReturnType<typeof heldContext>>;
    try {
      context = await heldContext(tenantId, runId);
    } catch (error) {
      log.error("Resume context unavailable", {
        runId,
        ...requestErrorMetadata(error),
      });
    }
    if (context === undefined) return next();
    const body = await readJson(c.req.raw.clone());
    if (!isRecord(body) || typeof body["content"] !== "string") return next();
    const headers = new Headers(c.req.raw.headers);
    headers.delete("content-length");
    c.req.raw = new Request(c.req.raw, {
      method: "POST",
      headers,
      body: JSON.stringify({
        ...body,
        content: resumeMessage(context, body["content"]),
      }),
    });
    return next();
  };
}
