// Live SSE stream of a workflow run's InferenceEvent frames from
// `sidecarRouter.subscribeAgent`. Mail the router delivers for the run's address and the loss of its sidecar route
// ride along as `mail` and `status` frames, carrying no mail content. The stream does not replay
// calls made before it opened, so the calls a run made so far are read from its saved conversation.

import { type } from "arktype";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { DB } from "@intx/db";
import { idResource, type RequireGrant, type TenantEnv } from "@intx/hub-api";
import { findRoutableById, type SidecarRouter } from "@intx/hub-sessions";
import { getLogger } from "@intx/log";
import { parseInferenceEvent } from "@intx/types/runtime";
import { ContentBlock } from "@intx/types/runtime-core";
import type { RunStep } from "@corbits-builder/schemas/activity";
import type { CoordinatorRepoDirSource } from "./mail/coordinator-question.ts";
import { isRecord, readCommittedTurns } from "./mail/conversation-turns.ts";
import { errorCode, requestErrorMetadata } from "./request-error.ts";

const HEARTBEAT_MS = 5_000;
const MailDelivered = type({
  type: "'mail.delivered'",
  data: { id: "string", direction: "'inbound' | 'outbound'" },
});
const log = getLogger(["corbits-builder", "run-stream"]);

/** Each call in saved turns, in the order the run made them, and whether its result came back. */
function runSteps(turns: readonly unknown[]): RunStep[] {
  const blocks = turns
    .filter(isRecord)
    .flatMap((turn) => (Array.isArray(turn["content"]) ? turn["content"] : []))
    .flatMap((block) => {
      const parsed = ContentBlock(block);
      return parsed instanceof type.errors ? [] : [parsed];
    });
  const returned = new Set(
    blocks.flatMap((block) =>
      block.type === "tool_result" ? [block.callId] : [],
    ),
  );
  return blocks.flatMap((block) =>
    block.type === "tool_call"
      ? [
          {
            callId: block.id,
            name: block.name,
            arguments: block.arguments,
            returned: returned.has(block.id),
          },
        ]
      : [],
  );
}

export function createWorkflowRunStreamRoutes(deps: {
  readonly db: DB["db"];
  readonly sidecarRouter: Pick<SidecarRouter, "subscribeAgent" | "events">;
  readonly requireGrant: RequireGrant;
  readonly repoStore: CoordinatorRepoDirSource;
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
      const record = await findRun(
        deps.db,
        c.req.param("runId"),
        c.get("tenant").id,
      );
      if (record === undefined) {
        return c.json(
          { error: { code: "not_found", message: "Run not found" } },
          404,
        );
      }
      const turns = await readCommittedTurns(deps.repoStore, record.address);
      return c.json({ steps: runSteps(turns ?? []) });
    },
  );

  return app;
}
