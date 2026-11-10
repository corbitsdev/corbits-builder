/**
 * What the Collaborators section does: reads the workspace's roles, its open invitations and the
 * caller's own membership from the hub's role, grant and invitation routes, and makes and
 * revokes invitations.
 *
 * The hub reads only the caller's own memberships (`/api/me/principals`), not a member
 * directory, so the section lists you and every open invitation and says that other members
 * are not listed.
 */
import { wording } from "../../config.ts";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { productClient } from "../../api/transport.ts";
import { workspaceTenantId, type HubUser } from "../../api/auth.ts";
import type { Invitation } from "@corbits-builder/schemas/invitation";
import { ProductApiError } from "@corbits-builder/client";
import { responseCode } from "../workspace/human-fault.ts";
import type { CollaboratorsViewProps } from "./collaborators.view.tsx";

export type CollaboratorsProps = { user: HubUser | null };

const INVITE_TTL_DAYS = 7;

function invitationLink(invitationPath: string): string {
  return new URL(invitationPath, window.location.origin).href;
}

function expiresInLabel(expiresAt: string): string {
  const at = Date.parse(expiresAt);
  if (Number.isNaN(at)) return expiresAt;
  const days = Math.ceil((at - Date.now()) / 86_400_000);
  return days <= 0
    ? "expired"
    : `${String(days)} day${days === 1 ? "" : "s"} left`;
}

async function refusal(cause: unknown): Promise<string> {
  if (!(cause instanceof ProductApiError))
    return cause instanceof Error ? cause.message : String(cause);
  const code = await responseCode(cause);
  const refused =
    code === undefined
      ? undefined
      : wording.settings.collaborators.refused[code];
  return refused ?? wording.settings.collaborators.failed;
}

export function useCollaborators({
  user,
}: CollaboratorsProps): CollaboratorsViewProps {
  const [roles, setRoles] = useState<CollaboratorsViewProps["roles"]>(null);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [myRoles, setMyRoles] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [roleId, setRoleId] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const read = useCallback(async () => {
    try {
      const client = productClient();
      const tenantId = await workspaceTenantId();
      const [rolePage, invitePage, principals] = await Promise.all([
        client.tenantRoles(tenantId),
        client.invitations(tenantId),
        client.mePrincipals(),
      ]);
      setRoles(rolePage.data);
      setInvitations(
        invitePage.invitations.filter((row) => row.state === "pending"),
      );
      const mine = principals.data.find(
        (principal) => principal.tenantId === tenantId,
      );
      setMyRoles(mine?.roles.map((role) => role.name) ?? null);
      setError(null);
    } catch (cause) {
      setError(await refusal(cause));
    }
  }, []);

  useEffect(() => {
    void read();
  }, [read]);

  const create = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const client = productClient();
      const tenantId = await workspaceTenantId();
      const expiresAt = new Date(
        Date.now() + INVITE_TTL_DAYS * 86_400_000,
      ).toISOString();
      const creation = await client.createInvitation(tenantId, {
        idempotencyKey: crypto.randomUUID(),
        email: email.trim(),
        roleId,
        expiresAt,
      });
      setNotice(
        `Invitation created for ${creation.invitation.email}. Their link: ${invitationLink(creation.invitationPath)}${creation.delivery === "sent" ? " — an email was sent." : " — email delivery is not configured; share the link yourself."}`,
      );
      setEmail("");
      await read();
    } catch (cause) {
      toast.error(await refusal(cause));
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (invitationId: string) => {
    setBusy(true);
    setError(null);
    try {
      const client = productClient();
      await client.revokeInvitation(await workspaceTenantId(), invitationId);
      await read();
    } catch (cause) {
      toast.error(await refusal(cause));
    } finally {
      setBusy(false);
    }
  };

  return {
    fault: error,
    notice,
    you: user,
    yourRoles: myRoles,
    roles,
    email,
    onEmailChange: setEmail,
    roleId,
    onRoleChange: setRoleId,
    busy,
    canInvite: email.trim() !== "" && roleId !== "",
    onInvite: () => void create(),
    invitations: invitations.map((invitation) => ({
      id: invitation.id,
      email: invitation.email,
      expires: expiresInLabel(invitation.expiresAt),
    })),
    onRevoke: (invitationId) => void revoke(invitationId),
  };
}
