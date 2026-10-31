import { tenantPath, type ClientDeps, type ProductApiClient } from "./shared";

export function buildInvitationMethods(
  deps: ClientDeps,
): Pick<
  ProductApiClient,
  | "createInvitation"
  | "invitations"
  | "revokeInvitation"
  | "invitation"
  | "acceptInvitation"
> {
  const { request } = deps;
  return {
    createInvitation(tenantId, invitation, signal) {
      return request(`${tenantPath(tenantId)}/invitations`, signal, invitation);
    },
    invitations(tenantId, signal) {
      return request(`${tenantPath(tenantId)}/invitations`, signal);
    },
    revokeInvitation(tenantId, invitationId, signal) {
      return request(
        `${tenantPath(tenantId)}/invitations/${encodeURIComponent(invitationId)}/revoke`,
        signal,
        {},
      );
    },
    invitation(invitationId, signal) {
      return request(
        `/api/invitations/${encodeURIComponent(invitationId)}`,
        signal,
      );
    },
    acceptInvitation(invitationId, signal) {
      return request(
        `/api/invitations/${encodeURIComponent(invitationId)}/accept`,
        signal,
        {},
      );
    },
  };
}
