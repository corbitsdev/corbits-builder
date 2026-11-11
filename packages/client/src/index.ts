export type {
  InvitationCreation,
  InvitationList,
} from "@corbits-builder/schemas/invitation";

import { buildArtifactsMethods } from "./client/artifacts";
import { buildAuthMethods } from "./client/auth";
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

export type { MePrincipalsPage, MePrincipal, Workspace } from "./client/auth";
export type {
  ApprovalScope,
  NativeApproval,
  PackageZipReviewerQuery,
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
} from "./client/credentials";
export type {
  ActivityTool,
  AgentActivity,
  ProjectActivity,
} from "@corbits-builder/schemas/activity";
export type {
  ApprovalReviewer,
  ApprovalRound,
  ApprovalRoundList,
  ApprovalRoundStatus,
  ExpiryPreset,
  RecordReviewerDecision,
  ReviewerDecision,
  ReviewerInput,
  ReviewerOutcome,
  ReviewerState,
  SlideNote,
  StartApprovalRound,
  TriageAction,
  TriageDecisionInput,
  TriageItem,
  TriageItemStatus,
  WorkspaceReviewer,
} from "@corbits-builder/schemas/approval-round";
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
    method: "POST" | "PATCH" | "DELETE" = "POST",
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

  const deps: ClientDeps = {
    request,
    baseUrl,
    headers,
    fetchRequest,
    options,
  };
  return Object.freeze({
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
