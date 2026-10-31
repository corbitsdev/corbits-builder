import { tenantPath, type ClientDeps, type ProductApiClient } from "./shared";

export function buildReviewsMethods(
  deps: ClientDeps,
): Pick<
  ProductApiClient,
  "nativeApprovals" | "nativeApproval" | "decideNativeApproval"
> {
  const { request } = deps;
  return {
    // The native approval surfaces are the upstream interchange routes the hub
    // composes directly; grant management reads the exact ask (materials,
    // deadline) a decision is issued against.
    nativeApprovals(tenantId, signal) {
      return request(`${tenantPath(tenantId)}/approvals`, signal);
    },
    nativeApproval(tenantId, approvalId, signal) {
      return request(
        `${tenantPath(tenantId)}/approvals/${encodeURIComponent(approvalId)}`,
        signal,
      );
    },
    decideNativeApproval(
      tenantId,
      approvalId,
      decision,
      scope = "once",
      message,
      signal,
    ) {
      return request(
        `${tenantPath(tenantId)}/approvals/${encodeURIComponent(approvalId)}/${decision}`,
        signal,
        message === undefined ? { scope } : { scope, message },
      );
    },
  };
}
