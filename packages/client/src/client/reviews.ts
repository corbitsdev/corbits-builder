import { tenantPath, type ClientDeps, type ProductApiClient } from "./shared";

export function buildReviewsMethods(
  deps: ClientDeps,
): Pick<
  ProductApiClient,
  | "nativeApprovals"
  | "nativeApproval"
  | "decideNativeApproval"
  | "respondToNativeApproval"
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
    // An ask whose result is the person's own input, such as questions, is responded to rather
    // than run: the result is what the waiting call returns.
    respondToNativeApproval(tenantId, approvalId, result, signal) {
      return request(
        `${tenantPath(tenantId)}/approvals/${encodeURIComponent(approvalId)}/respond`,
        signal,
        { result },
      );
    },
  };
}
