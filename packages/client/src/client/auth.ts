import { type ClientDeps, type ProductApiClient } from "./shared";

export type MePrincipal = Readonly<{
  principalId: string;
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  kind: string;
  status: string;
  roles: Readonly<{ id: string; name: string }>[];
}>;

export type MePrincipalsPage = Readonly<{
  data: MePrincipal[];
  nextCursor: string | null;
}>;

/** A root tenant the person belongs to under the install root. */
export type Workspace = Readonly<{
  id: string;
  name: string;
}>;

export function buildAuthMethods(
  deps: ClientDeps,
): Pick<ProductApiClient, "mePrincipals" | "workspaces" | "createWorkspace"> {
  const { request } = deps;
  return {
    mePrincipals(query, signal) {
      const search = new URLSearchParams();
      if (query?.cursor) search.set("cursor", query.cursor);
      if (query?.limit !== undefined) search.set("limit", String(query.limit));
      const qs = search.toString();
      return request(`/api/me/principals${qs ? `?${qs}` : ""}`, signal);
    },
    workspaces(signal) {
      return request("/api/workspaces", signal);
    },
    createWorkspace(input, signal) {
      return request("/api/workspaces", signal, input);
    },
  };
}
