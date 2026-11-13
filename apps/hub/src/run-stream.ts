// Live SSE stream of a workflow run's InferenceEvent frames from
// `sidecarRouter.subscribeAgent`. Mail the router delivers for the run's address and the loss of its sidecar route
// ride along as `mail` and `status` frames, carrying no mail content. The stream does not replay
// calls made before it opened, so the calls a run made so far are read from its saved conversation,
// and those of the message it is on, which it saves only once that message is done, from what the
// hub has seen of its events.

import { type } from "arktype";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { DB } from "@intx/db";
import { idResource, type RequireGrant, type TenantEnv } from "@intx/hub-api";
import { findRoutableById, type SidecarRouter } from "@intx/hub-sessions";
import { getLogger } from "@intx/log";
import { parseInferenceEvent } from "@intx/types/runtime";
import { ContentBlock } from "@intx/types/runtime-core";
import type { RunStep, RunSteps } from "@corbits-builder/schemas/activity";
import type { AgentActivityTracker } from "./artifacts/activity.ts";
import type { CoordinatorRepoDirSource } from "./mail/coordinator-question.ts";
import { isRecord, readCommittedTurns } from "./mail/conversation-turns.ts";
import { errorCode, requestErrorMetadata } from "./request-error.ts";

const HEARTBEAT_MS = 5_000;
// A result is kept to its end, as long as a command's report keeps of its output.
const RESULT_TAIL_CHARS = 4096;
const MailDelivered = type({
  type: "'mail.delivered'",
  data: { id: "string", direction: "'inbound' | 'outbound'" },
});
const log = getLogger(["corbits-builder", "run-stream"]);

/**
 * Each call in saved turns, in the order the run made them, with when its turn was saved and the
 * text of its result once it came back, kept to its end as a command's output is.
 */
export function runSteps(turns: readonly unknown[]): RunStep[] {
  const blocks = turns.filter(isRecord).flatMap((turn) => {
    const at = turn["timestamp"];
    if (typeof at !== "number" || !Array.isArray(turn["content"])) return [];
    return turn["content"].flatMap((block) => {
      const parsed = ContentBlock(block);
      return parsed instanceof type.errors ? [] : [{ at, block: parsed }];
    });
  });
  const results = new Map<string, NonNullable<RunStep["result"]>>();
  for (const { block } of blocks) {
    if (block.type !== "tool_result") continue;
    const content = block.content
      .flatMap((part) => (part.type === "text" ? [part.text] : []))
      .join("\n")
      .slice(-RESULT_TAIL_CHARS);
    results.set(block.callId, { content, isError: block.isError === true });
  }
  return blocks.flatMap(({ at, block }): RunStep[] => {
    if (block.type !== "tool_call") return [];
    const step: RunStep = {
      callId: block.id,
      name: block.name,
      arguments: block.arguments,
      at,
    };
    const result = results.get(block.id);
    if (result !== undefined) step.result = result;
    return [step];
  });
}

export function createWorkflowRunStreamRoutes(deps: {
  readonly db: DB["db"];
  readonly sidecarRouter: Pick<SidecarRouter, "subscribeAgent" | "events">;
  readonly requireGrant: RequireGrant;
  readonly repoStore: CoordinatorRepoDirSource;
  readonly activity: Pick<AgentActivityTracker, "unsaved">;
  readonly findRun?: typeof findRoutableById;
}): Hono<TenantEnv> {
  const findRun = deps.findRun ?? findRoutableById;
  const app = new Hono<TenantEnv>();

  app.get(
    "/workflows/runs/:runId/stream",
    deps.requireGrant(idResource("workflow-run", "runId"), "read"),
    async (c) => {
      const runId = c.req.param("runId");
      const record = await findRun(deps.db, runId, c.get("tenant").id);
      if (record === undefined) {
        return c.json(
          { error: { code: "not_found", message: "Run not found" } },
          404,
        );
      }

      c.header("Cache-Control", "no-cache");
      c.header("X-Accel-Buffering", "no");

      return streamSSE(c, async (stream) => {
        async function send(message: { event: string; data: string }) {
          try {
            await stream.writeSSE(message);
          } catch (error) {
            log.error("Workflow run stream {event} write failed for {runId}", {
              event: message.event,
              runId,
              ...errorCode(error),
              ...requestErrorMetadata(error),
            });
          }
        }
        const write = (event: string, data: unknown) =>
          void send({ event, data: JSON.stringify(data) });
        const unsubscribe = deps.sidecarRouter.subscribeAgent(
          record.address,
          (raw) => {
            const mail = MailDelivered(raw);
            if (!(mail instanceof type.errors)) {
              write("mail", {
                id: mail.data.id,
                direction: mail.data.direction,
              });
              return;
            }
            const event = parseInferenceEvent(raw);
            if (event instanceof type.errors) return;
            write("run", event);
          },
        );
        const offDisconnect = deps.sidecarRouter.events.on(
          "sidecar.disconnect",
          (lost) => {
            if (lost.ownedAddresses.includes(record.address))
              write("status", { routable: false });
          },
        );
        const heartbeat = setInterval(
          () => void send({ event: "ping", data: "" }),
          HEARTBEAT_MS,
        );

        try {
          await new Promise<void>((resolve) => {
            if (c.req.raw.signal.aborted) return resolve();
            c.req.raw.signal.addEventListener("abort", () => resolve(), {
              once: true,
            });
          });
        } finally {
          clearInterval(heartbeat);
          unsubscribe();
          offDisconnect();
        }
      });
    },
  );

  app.get(
    "/workflows/runs/:runId/steps",
    deps.requireGrant(idResource("workflow-run", "runId"), "read"),
    async (c) => {
      const runId = c.req.param("runId");
      const record = await findRun(deps.db, runId, c.get("tenant").id);
      if (record === undefined) {
        return c.json(
          { error: { code: "not_found", message: "Run not found" } },
          404,
        );
      }
      const turns = await readCommittedTurns(deps.repoStore, record.address);
      const steps = runSteps(turns ?? []);
      const known = new Set(steps.map((step) => step.callId));
      // A message just done can be in both until the run starts its next one.
      const current = runSteps(deps.activity.unsaved(runId)).filter(
        (step) => !known.has(step.callId),
      );
      const saved: RunSteps = {
        status: record.status,
        steps: [...steps, ...current],
      };
      if (record.failureMessage !== null) saved.error = record.failureMessage;
      return c.json(saved);
    },
  );

  return app;
}
