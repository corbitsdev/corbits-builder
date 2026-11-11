import { tenantPath, type ClientDeps, type ProductApiClient } from "./shared";

export function buildReviewsMethods(
  deps: ClientDeps,
): Pick<ProductApiClient, "nativeApprovals" | "decideNativeApproval"> {
  const { request } = deps;
  return {
    nativeApprovals(tenantId, signal) {
      return request(`${tenantPath(tenantId)}/approvals`, signal);
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
