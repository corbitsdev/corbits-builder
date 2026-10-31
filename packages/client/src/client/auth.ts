import { tenantPath, type ClientDeps, type ProductApiClient } from "./shared";

export type MeProfile = Readonly<{
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image: string | null;
  createdAt: string;
  updatedAt: string;
}>;

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

export type Tenant = Readonly<{
  id: string;
  name: string;
  slug: string;
}>;

/** A root tenant the person belongs to under the install root. */
export type Workspace = Readonly<{
  id: string;
  name: string;
}>;

export type HelloResponse = Readonly<{
  productName: string;
  message: string;
  configuredNaming: boolean;
  principalId: string;
  tenantId: string;
  authenticated: true;
}>;

export function buildAuthMethods(
  deps: ClientDeps,
): Pick<
  ProductApiClient,
  | "me"
  | "createTenant"
  | "mePrincipals"
  | "hello"
  | "workspaces"
  | "createWorkspace"
> {
  const { request } = deps;
  return {
    me(signal) {
      return request("/api/me", signal);
    },
    createTenant(input, signal) {
      return request("/api/tenants", signal, input);
    },
    mePrincipals(query, signal) {
      const search = new URLSearchParams();
      if (query?.cursor) search.set("cursor", query.cursor);
      if (query?.limit !== undefined) search.set("limit", String(query.limit));
      const qs = search.toString();
      return request(`/api/me/principals${qs ? `?${qs}` : ""}`, signal);
    },
    hello(tenantId, signal) {
      return request(`${tenantPath(tenantId)}/product/hello`, signal);
    },
    workspaces(signal) {
      return request("/api/workspaces", signal);
    },
    createWorkspace(input, signal) {
      return request("/api/workspaces", signal, input);
    },
  };
}
