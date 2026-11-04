import { and, eq } from "drizzle-orm";
import type { MiddlewareHandler } from "hono";
import type { DB } from "@intx/db";
import { approval } from "@intx/db/schema";
import { getLogger } from "@intx/log";
import { declineNote } from "../config/decline.ts";
import { projectCoordinator } from "../db/schema.ts";
import { requestErrorMetadata } from "../request-error.ts";
import { readJson } from "../lib/json.ts";
import { isRecord } from "../mail/conversation-turns.ts";

const log = getLogger(["corbits-builder", "hub", "decline-note"]);

/** Whether an approval is one of a project coordinator's own asks. */
export function coordinatorAskReader(db: DB["db"]) {
  return async (tenantId: string, approvalId: string): Promise<boolean> => {
    const [asked] = await db
      .select({ runId: approval.runId })
      .from(approval)
      .innerJoin(
        projectCoordinator,
        eq(projectCoordinator.runId, approval.runId),
      )
      .where(and(eq(approval.id, approvalId), eq(approval.tenantId, tenantId)))
      .limit(1);
    return asked !== undefined;
  };
}

/**
 * A decline of one of a coordinator's asks carries the hub's note around the person's words, so
 * the coordinator reads it as their answer. Other declines, such as the coder's package asks, and
 * a body Interchange's own validation should refuse, pass through unchanged.
 */
export function createDeclineNote(deps: {
  coordinatorAsk: (tenantId: string, approvalId: string) => Promise<boolean>;
}): MiddlewareHandler {
  return async (c, next) => {
    const tenantId = c.req.param("tenantId");
    const approvalId = c.req.param("approvalId");
    if (c.req.method !== "POST" || !tenantId || !approvalId) return next();
    const body: unknown = await readJson(c.req.raw.clone());
    if (!isRecord(body)) return next();
    const words = body["message"];
    if (words !== undefined && typeof words !== "string") return next();
    // A note that cannot be written must not cost the person their decision.
    try {
      if (!(await deps.coordinatorAsk(tenantId, approvalId))) return next();
    } catch (error) {
      log.error("Decline note unavailable", {
        approvalId,
        ...requestErrorMetadata(error),
      });
      return next();
    }
    const headers = new Headers(c.req.raw.headers);
    headers.delete("content-length");
    c.req.raw = new Request(c.req.raw, {
      method: "POST",
      headers,
      body: JSON.stringify({ ...body, message: declineNote(words) }),
    });
    return next();
  };
}
