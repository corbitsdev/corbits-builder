import { type } from "arktype";
import { ProjectId } from "./project.ts";

export const CreateInvitation = type({
  "+": "reject",
  idempotencyKey: ProjectId,
  email: "string.email",
  roleId: "string > 0",
  expiresAt: "string > 0",
});
export const Invitation = type({
  "+": "reject",
  id: ProjectId,
  tenantId: "string > 0",
  email: "string.email",
  roleId: "string > 0",
  invitedBy: "string > 0",
  state: "'pending' | 'activated' | 'expired' | 'revoked'",
  expiresAt: "string > 0",
  createdAt: "string > 0",
  acceptedAt: "string | null",
  principalId: "string | null",
  revokedAt: "string | null",
});
export type Invitation = typeof Invitation.infer;

const creationResponse = {
  "+": "reject",
  invitation: Invitation,
  invitationPath: "string > 0",
} as const;
export const InvitationCreation = type({
  ...creationResponse,
  delivery: "'sent' | 'unconfigured' | 'not_attempted'",
});
export type InvitationCreation = typeof InvitationCreation.infer;
export const InvitationDeliveryFailure = type({
  ...creationResponse,
  delivery: "'failed'",
  code: "'invitation_email_delivery_failed'",
});
export type InvitationDeliveryFailure = typeof InvitationDeliveryFailure.infer;
export const InvitationList = type({
  "+": "reject",
  invitations: Invitation.array().atMostLength(100),
  limit: "100",
});
export type InvitationList = typeof InvitationList.infer;
