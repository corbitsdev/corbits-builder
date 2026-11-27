import { type ClientDeps, type ProductApiClient } from "./shared";

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
