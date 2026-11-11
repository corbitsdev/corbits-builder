import { tenantPath, type ClientDeps, type ProductApiClient } from "./shared";

/** A role from the native Interchange role listing, as the hub returned it. */
export type TenantRoleView = Readonly<{
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  createdAt: string;
  updatedAt: string;
}>;

export type TenantRolePage = Readonly<{
  data: TenantRoleView[];
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
): Pick<ProductApiClient, "tenantRoles"> {
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
  };
}
