import type { Hono } from "hono";
import type { TenantEnv } from "@intx/hub-api";
import type { DB } from "@intx/db";
import { describeRoute, resolver } from "hono-openapi";
import { ProjectAuditPage } from "@corbits-builder/schemas/audit";
import { ProjectError } from "../projects/errors.ts";
import { createProjectAuditService } from "./service.ts";

export function mountProjectAuditRoutes(app: Hono<TenantEnv>, db: DB["db"]) {
  const service = createProjectAuditService(db);
  app.get(
    "/:projectId/audit",
    describeRoute({
      tags: ["Projects"],
      operationId: "readProjectAudit",
      security: [
        { sessionCookie: [] },
        { deviceBearer: [] },
        { coordinatorBearer: [] },
      ],
      parameters: [
        ...["tenantId", "projectId"].map((name) => ({
          name,
          in: "path" as const,
          required: true,
          schema: { type: "string" as const },
        })),
        { name: "beforeTime", in: "query", schema: { type: "string" } },
        { name: "beforeId", in: "query", schema: { type: "string" } },
        {
          name: "limit",
          in: "query",
          schema: { type: "integer", minimum: 1, maximum: 100 },
        },
      ],
      responses: {
        200: {
          description: "Redacted persisted product events, newest first",
          content: {
            "application/json": { schema: resolver(ProjectAuditPage) },
          },
        },
        400: { description: "Invalid query or incomplete cursor" },
        403: { description: "Current project read authority required" },
        404: { description: "Project unavailable in this tenant" },
      },
    }),
    async (c) => {
      try {
        const query = c.req.query();
        if (
          Object.keys(query).some(
            (key) => !["beforeTime", "beforeId", "limit"].includes(key),
          )
        )
          throw new ProjectError(400, "invalid_audit_query");
        const page = await service.read(
          { tenantId: c.get("tenant").id, principalId: c.get("principal").id },
          c.req.param("projectId"),
          {
            ...(query.beforeTime !== undefined || query.beforeId !== undefined
              ? { before: { occurredAt: query.beforeTime, id: query.beforeId } }
              : {}),
            ...(query.limit !== undefined
              ? { limit: Number(query.limit) }
              : {}),
          },
        );
        c.header("cache-control", "no-store");
        return c.json(page);
      } catch (error) {
        if (error instanceof ProjectError)
          return c.json({ code: error.code }, error.status);
        throw error;
      }
    },
  );
}
