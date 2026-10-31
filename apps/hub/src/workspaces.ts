import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { and, asc, eq, isNull, ne, or } from "drizzle-orm";
import type { DB } from "@intx/db";
import { principal, tenant } from "@intx/db/schema";
import { requireAuth, type AppEnv } from "@intx/hub-api";
import { type } from "arktype";
import { nativeTenantCreation } from "./projects/routes.ts";
import { ProjectError } from "./projects/errors.ts";

const WorkspaceCreate = type({ name: "string > 0" });

/** Lists and creates a person's workspaces under the install root, through native tenant creation. */
export function createWorkspaceRoutes(
  db: DB["db"],
  rootId: string,
  nativeFetch: (request: Request) => Promise<Response>,
) {
  const app = new Hono<AppEnv>();
  app.use("*", requireAuth);
  app.get(
    "/",
    describeRoute({
      tags: ["Workspaces"],
      operationId: "listWorkspaces",
      security: [{ sessionCookie: [] }, { deviceBearer: [] }],
      responses: {
        200: { description: "The caller's workspaces, oldest first" },
      },
    }),
    async (c) => {
      const userId = c.get("user")?.id;
      if (!userId) return c.json({ data: [] });
      const data = await db
        .select({ id: tenant.id, name: tenant.name })
        .from(principal)
        .innerJoin(tenant, eq(tenant.id, principal.tenantId))
        .where(
          and(
            eq(principal.kind, "user"),
            eq(principal.refId, userId),
            eq(principal.status, "active"),
            // A workspace made before the install root existed is a root tenant of its own.
            or(
              eq(tenant.parentId, rootId),
              and(isNull(tenant.parentId), ne(tenant.id, rootId)),
            ),
          ),
        )
        .orderBy(asc(tenant.createdAt));
      return c.json({ data });
    },
  );
  app.post(
    "/",
    describeRoute({
      tags: ["Workspaces"],
      operationId: "createWorkspace",
      security: [{ sessionCookie: [] }, { deviceBearer: [] }],
      responses: {
        201: { description: "The workspace tenant, under the install root" },
        403: {
          description:
            "The caller holds no workspace-creator membership in the root",
        },
      },
    }),
    async (c) => {
      const input = WorkspaceCreate(await c.req.json().catch(() => null));
      if (input instanceof type.errors)
        throw new ProjectError(400, "invalid_workspace");
      const created = await nativeTenantCreation(
        c,
        nativeFetch,
      )({
        name: input.name,
        slug: `workspace-${crypto.randomUUID()}`,
        parentId: rootId,
      });
      return c.json(created, 201);
    },
  );
  return app;
}
