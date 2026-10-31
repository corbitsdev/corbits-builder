import { tenantPath, type ClientDeps, type ProductApiClient } from "./shared";

/**
 * Views of the native Interchange role and grant surfaces
 * (`/api/tenants/:tenantId/roles` and `/grants`). These are plain reads and
 * compositions over the hub's own authorization material; the client never
 * interprets them beyond what the hub returned.
 */
export type TenantRoleView = Readonly<{
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  createdAt: string;
  updatedAt: string;
}>;

export type TenantGrantView = Readonly<{
  id: string;
  resource: string;
  action: string;
  effect: "allow" | "deny" | "ask";
  origin: "system" | "role" | "creator" | "invoker";
  roleId: string | null;
  principalId: string | null;
  conditions: Record<string, unknown> | null;
  expiresAt: string | null;
}>;

export type TenantGrantInput = Readonly<{
  roleId: string;
  resource: string;
  action: string;
  effect: "allow" | "deny" | "ask";
  origin: "system" | "role" | "creator" | "invoker";
}>;

export type TenantRolePage = Readonly<{
  data: TenantRoleView[];
  nextCursor: string | null;
}>;
export type TenantGrantPage = Readonly<{
  data: TenantGrantView[];
  nextCursor: string | null;
}>;

type Page<T> = { data: T[]; nextCursor: string | null };

/** Page cap for a full listing; exceeding it fails loudly rather than lying by truncation. */
const MAX_PAGES = 10;

async function allPages<T>(
  request: ClientDeps["request"],
  basePath: string,
  signal?: AbortSignal,
) {
  const rows: T[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const search = new URLSearchParams({ limit: "100" });
    if (cursor !== null) search.set("cursor", cursor);
    const separator = basePath.includes("?") ? "&" : "?";
    const result = await request<Page<T>>(
      `${basePath}${separator}${search.toString()}`,
      signal,
    );
    rows.push(...result.data);
    if (!result.nextCursor) return rows;
    cursor = result.nextCursor;
  }
  throw new Error(`${basePath} listing exceeded ${MAX_PAGES} pages`);
}

export function buildRoleMethods(
  deps: ClientDeps,
): Pick<
  ProductApiClient,
  "tenantRoles" | "createTenantRole" | "tenantGrants" | "createTenantGrant"
> {
  const { request } = deps;
  return {
    async tenantRoles(tenantId, signal) {
      const data = await allPages<TenantRoleView>(
        request,
        `${tenantPath(tenantId)}/roles`,
        signal,
      );
      return { data, nextCursor: null };
    },
    createTenantRole(tenantId, input, signal) {
      return request(`${tenantPath(tenantId)}/roles`, signal, input);
    },
    async tenantGrants(tenantId, query = {}, signal) {
      const path = `${tenantPath(tenantId)}/grants`;
      const filters = new URLSearchParams();
      if (query.roleId !== undefined) filters.set("roleId", query.roleId);
      if (query.principalId !== undefined)
        filters.set("principalId", query.principalId);
      const suffix = filters.toString();
      const data = await allPages<TenantGrantView>(
        request,
        suffix === "" ? path : `${path}?${suffix}`,
        signal,
      );
      return { data, nextCursor: null };
    },
    createTenantGrant(tenantId, input, signal) {
      return request(`${tenantPath(tenantId)}/grants`, signal, input);
    },
  };
}
