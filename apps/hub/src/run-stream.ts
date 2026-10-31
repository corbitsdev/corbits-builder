// Live SSE stream of a workflow run's InferenceEvent frames from
// `sidecarRouter.subscribeAgent`. Mail the router delivers for the run's address and the loss of its sidecar route
// ride along as `mail` and `status` frames, carrying no mail content.

import { type } from "arktype";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { DB } from "@intx/db";
import { idResource, type RequireGrant, type TenantEnv } from "@intx/hub-api";
import { findRoutableById, type SidecarRouter } from "@intx/hub-sessions";
import { getLogger } from "@intx/log";
import { parseInferenceEvent } from "@intx/types/runtime";

const HEARTBEAT_MS = 5_000;
const MailDelivered = type({
  type: "'mail.delivered'",
  data: { id: "string", direction: "'inbound' | 'outbound'" },
});
const log = getLogger(["corbits-builder", "run-stream"]);

export function createWorkflowRunStreamRoutes(deps: {
  readonly db: DB["db"];
  readonly sidecarRouter: Pick<SidecarRouter, "subscribeAgent" | "events">;
  readonly requireGrant: RequireGrant;
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
        const write = (event: string, data: unknown) => {
          stream.writeSSE({ event, data: JSON.stringify(data) }).catch(() => {
            log.error(`Workflow run stream write failed for ${runId}`);
          });
        };
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
        const heartbeat = setInterval(() => {
          stream.writeSSE({ event: "ping", data: "" }).catch(() => {
            log.error(`Workflow run stream heartbeat failed for ${runId}`);
          });
        }, HEARTBEAT_MS);

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

  return app;
}
