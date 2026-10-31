import { and, eq, or } from "drizzle-orm";
import type { MiddlewareHandler } from "hono";
import { createGrantStore, type DB } from "@intx/db";
import { principal, tenant } from "@intx/db/schema";
import { evaluateGrants } from "@intx/authz";
import { HUB_CONDITION_REGISTRY, type TenantEnv } from "@intx/hub-api";
import { project } from "../db/schema.ts";
import { ProjectError, projectResource } from "./errors.ts";
import type { Actor } from "../lib/actor.ts";

export type Allowed = (resource: string, action: string) => Promise<boolean>;

export const actorOf = (c: {
  get(key: "tenant"): { id: string };
  get(key: "principal"): { id: string };
}): Actor => ({
  tenantId: c.get("tenant").id,
  principalId: c.get("principal").id,
});

export async function reportAuthorization(
  db: DB["db"],
  actor: Actor,
): Promise<Allowed> {
  const [active] = await db
    .select({ id: principal.id })
    .from(principal)
    .where(
      and(
        eq(principal.id, actor.principalId),
        eq(principal.tenantId, actor.tenantId),
        eq(principal.status, "active"),
      ),
    );
  if (!active) throw new ProjectError(403, "forbidden");
  return grantAuthorization(db, actor);
}

export async function grantAuthorization(
  db: DB["db"],
  actor: Actor,
): Promise<Allowed> {
  const grants = await createGrantStore(db).collectGrants(
    actor.principalId,
    actor.tenantId,
  );
  return async (resource, action) =>
    (
      await evaluateGrants(grants, resource, action, {
        principalId: actor.principalId,
        tenantId: actor.tenantId,
        conditions: HUB_CONDITION_REGISTRY,
      })
    ).effect === "allow";
}

// The actor's project in its tenant, once its grants allow the action on it.
export async function authorizeProject(
  db: DB["db"],
  actor: Actor,
  projectId: string,
  action: string,
) {
  const [row] = await db
    .select({ status: project.status })
    .from(project)
    .where(
      and(eq(project.id, projectId), eq(project.tenantId, actor.tenantId)),
    );
  if (!row) throw new ProjectError(404, "project_not_found");
  const allowed = await reportAuthorization(db, actor);
  if (!(await allowed(projectResource(projectId), action)))
    throw new ProjectError(403, "forbidden");
  return { status: row.status, allowed };
}

// Native tenant membership: the user's active `user` principal in the tenant,
// the rule hub-api's resolveTenantPrincipal applies (principal-lookup.ts), which
// its package index does not export.
export async function userPrincipalIn(
  db: DB["db"],
  tenantId: string,
  userId: string,
) {
  return db.query.principal.findFirst({
    where: and(
      eq(principal.tenantId, tenantId),
      eq(principal.kind, "user"),
      eq(principal.refId, userId),
      eq(principal.status, "active"),
    ),
  });
}

// A project is its own child tenant. Requests address it under the workspace
// tenant or the project tenant itself; the caller acts as its principal in the
// project tenant, so downstream services and native grants see that tenant.
// Unknown projects and non-members fall through unchanged and fail closed in
// the services, which scope every read to the resolved tenant.
export function resolveProjectTenant(
  db: DB["db"],
): MiddlewareHandler<TenantEnv> {
  return async (c, next) => {
    const projectId = c.req.param("projectId");
    const routeTenant = c.get("tenant");
    if (!projectId || !routeTenant) return next();
    const [row] = await db
      .select({ tenant })
      .from(project)
      .innerJoin(tenant, eq(tenant.id, project.tenantId))
      .where(
        and(
          eq(project.id, projectId),
          or(
            eq(tenant.id, routeTenant.id),
            eq(tenant.parentId, routeTenant.id),
          ),
        ),
      );
    if (!row) return next();
    const current = c.get("principal");
    if (current.tenantId === row.tenant.id) {
      c.set("tenant", row.tenant);
      return next();
    }
    const user = c.get("user");
    const member = user
      ? await userPrincipalIn(db, row.tenant.id, user.id)
      : undefined;
    if (!member) return next();
    c.set("tenant", row.tenant);
    c.set("principal", member);
    return next();
  };
}
