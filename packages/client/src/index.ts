export type {
  InvitationCreation,
  InvitationList,
} from "@corbits-builder/schemas/invitation";

import { buildArtifactsMethods } from "./client/artifacts";
import { buildAuthMethods } from "./client/auth";
import { buildCatalogMethods } from "./client/catalog";
import { buildCredentialsMethods } from "./client/credentials";
import { buildConversationMethods } from "./client/conversations";
import { buildInvitationMethods } from "./client/invitations";
import { buildProjectsMethods } from "./client/projects";
import { buildReviewsMethods } from "./client/reviews";
import { buildRoleMethods } from "./client/roles";
import { buildSettingsMethods } from "./client/settings";
import {
  ProductApiError,
  type ClientDeps,
  type ProductApiClient,
  type ProductApiClientOptions,
} from "./client/shared";

export type {
  HelloResponse,
  MePrincipalsPage,
  MePrincipal,
  MeProfile,
  Tenant,
  Workspace,
} from "./client/auth";
export type {
  ApprovalScope,
  NativeApproval,
  ProductApiClient,
  ProductApiClientOptions,
  ProjectArtifact,
} from "./client/shared";
export type {
  ModelCredentialInput,
  ModelCredentialReceipt,
  ModelLogin,
  ModelLoginPlugin,
  ModelLoginState,
  ModelProviderView,
} from "./client/credentials";
export type {
  ActivityTool,
  AgentActivity,
  ProjectActivity,
} from "@corbits-builder/schemas/activity";
export { ProductApiError };

export function createProductApiClient(
  options: ProductApiClientOptions,
): ProductApiClient {
  const baseUrl = new URL(options.baseUrl);
  const headers = new Headers(options.headers);
  headers.set("Accept", "application/json");
  const fetchRequest = options.fetch ?? ((request: Request) => fetch(request));

  async function request<T>(
    path: string,
    signal?: AbortSignal,
    mutation?: unknown,
    method: "POST" | "PATCH" = "POST",
  ): Promise<T> {
    const requestHeaders = new Headers(headers);
    if (mutation !== undefined)
      requestHeaders.set("Content-Type", "application/json");
    const response = await fetchRequest(
      new Request(new URL(path, baseUrl).href, {
        method: mutation === undefined ? "GET" : method,
        headers: requestHeaders,
        cache: "no-store",
        credentials: options.credentials ?? "same-origin",
        ...(signal ? { signal } : {}),
        ...(mutation === undefined ? {} : { body: JSON.stringify(mutation) }),
      }),
    );
    if (!response.ok) throw new ProductApiError(response);
    return (await response.json()) as T;
  }

  async function catalogResponse(
    path: string,
    signal?: AbortSignal,
  ): Promise<unknown> {
    try {
      return await request(path, signal);
    } catch (error) {
      signal?.throwIfAborted();
      if (error instanceof ProductApiError) throw error;
      // JSON parser diagnostics may include server-provided text. Never echo it.
      throw new Error("native_catalog_response_unavailable");
    }
  }

  const deps: ClientDeps = {
    request,
    catalogResponse,
    baseUrl,
    headers,
    fetchRequest,
    options,
  };
  return Object.freeze({
    ...buildCatalogMethods(deps),
    ...buildCredentialsMethods(deps),
    ...buildArtifactsMethods(deps),
    ...buildSettingsMethods(deps),
    ...buildInvitationMethods(deps),
    ...buildReviewsMethods(deps),
    ...buildRoleMethods(deps),
    ...buildAuthMethods(deps),
    ...buildConversationMethods(deps),
    ...buildProjectsMethods(deps),
  });
}
