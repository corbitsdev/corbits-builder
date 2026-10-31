import { type } from "arktype";
import { and, eq, desc, sql } from "drizzle-orm";
import type { DB } from "@intx/db";
import {
  AuditQuery,
  AuditEventType,
  ProjectAuditPage,
} from "@corbits-builder/schemas/audit";
import { ProjectId } from "@corbits-builder/schemas/project";
import { outbox, project } from "../db/schema.ts";
import { reportAuthorization } from "../projects/authorization.ts";
import { ProjectError, projectResource } from "../projects/errors.ts";

function checkedAuditQuery(raw: unknown): AuditQuery {
  const input = AuditQuery(raw);
  if (input instanceof type.errors)
    throw new ProjectError(400, "invalid_audit_query");
  if (input.before) {
    const date = new Date(input.before.occurredAt);
    if (
      !Number.isFinite(date.getTime()) ||
      date.toISOString() !== input.before.occurredAt.slice(0, 23) + "Z"
    )
      throw new ProjectError(400, "invalid_audit_cursor");
  }
  return input;
}

export function createProjectAuditService(db: DB["db"]) {
  return {
    async read(
      actor: { tenantId: string; principalId: string },
      projectId: string,
      raw: unknown,
    ) {
      if (!ProjectId.allows(projectId))
        throw new ProjectError(400, "invalid_project_id");
      const input = checkedAuditQuery(raw);
      const requireRead = async () => {
        const allowed = await reportAuthorization(db, actor);
        if (!(await allowed(projectResource(projectId), "read")))
          throw new ProjectError(403, "project_audit_refused");
      };
      await requireRead();
      const [parent] = await db
        .select({ id: project.id })
        .from(project)
        .where(
          and(eq(project.id, projectId), eq(project.tenantId, actor.tenantId)),
        );
      if (!parent) throw new ProjectError(404, "project_not_found");
      const limit = input.limit ?? 50;
      // Select no payload column. Even an unknown future event cannot put its
      // private data or arbitrary event label into this redacted surface.
      const rows = await db
        .select({
          id: outbox.id,
          eventType: outbox.eventType,
          occurredAt: sql<string>`to_char(${outbox.occurredAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
        })
        .from(outbox)
        .innerJoin(project, eq(project.id, outbox.projectId))
        .where(
          and(
            eq(outbox.projectId, projectId),
            eq(project.tenantId, actor.tenantId),
            input.before
              ? sql`(${outbox.occurredAt}, ${outbox.id}) < (${input.before.occurredAt}::timestamptz, ${input.before.id})`
              : undefined,
          ),
        )
        .orderBy(desc(outbox.occurredAt), desc(outbox.id))
        .limit(limit + 1);
      await requireRead();
      const events = rows.slice(0, limit).map((row) => ({
        ...row,
        eventType: AuditEventType.allows(row.eventType)
          ? row.eventType
          : ("unclassified" as const),
      }));
      const last = events.at(-1);
      return ProjectAuditPage.assert({
        events,
        nextCursor:
          rows.length > limit && last
            ? { occurredAt: last.occurredAt, id: last.id }
            : null,
        coverage: "persisted_product_events",
        payloads: "withheld",
      });
    },
  };
}
