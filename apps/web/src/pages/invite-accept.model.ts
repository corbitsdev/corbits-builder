/**
 * The invitation accept screen's logic. The hub mints an invitation path on
 * creation; the person who accepts arrives there. This reads the invitation
 * record, then accepts, or reports the invitation's state (expired, revoked,
 * already activated). The hub has no decline endpoint; an unaccepted link
 * expires or is revoked.
 */
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ProductApiError } from "@corbits-builder/client";
import type { Invitation } from "@corbits-builder/schemas/invitation";
import { productClient } from "../api/transport.ts";
import { getHubSession, type HubUser } from "../api/auth.ts";
import { navigate } from "../routes.ts";
import type { InvitationAcceptViewProps } from "./invite-accept.view.tsx";

export type InvitationAcceptProps = { invitationId: string };

export function useInvitationAccept({
  invitationId,
}: InvitationAcceptProps): InvitationAcceptViewProps {
  const [invitation, setInvitation] = useState<Invitation | null>(null);
  const [roleName, setRoleName] = useState<string | null>(null);
  const [user, setUser] = useState<HubUser | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [accepted, setAccepted] = useState<Invitation | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const client = productClient();
        const [record, session] = await Promise.all([
          client.invitation(invitationId),
          getHubSession(),
        ]);
        if (cancelled) return;
        setInvitation(record);
        setUser(session?.user ?? null);
        try {
          const tenantId = record.tenantId;
          const roles = await client.tenantRoles(tenantId);
          if (!cancelled)
            setRoleName(
              roles.data.find((role) => role.id === record.roleId)?.name ??
                null,
            );
        } catch (cause) {
          // The role name is a courtesy the invitee may not be allowed to
          // read; the accept does not depend on it.
          if (
            !(cause instanceof ProductApiError) ||
            (cause.response.status !== 403 && cause.response.status !== 404)
          )
            console.warn(
              "The invitation's role name could not be read.",
              cause,
            );
        }
      } catch (cause) {
        if (!cancelled)
          setFailed(cause instanceof Error ? cause.message : String(cause));
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [invitationId]);

  const accept = async () => {
    setBusy(true);
    try {
      const result = await productClient().acceptInvitation(invitationId);
      setAccepted(result);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const shown = (): InvitationAcceptViewProps["invitation"] => {
    if (accepted !== null) return { status: "accepted", role: roleName };
    if (failed !== null) return { status: "unreadable", reason: failed };
    if (invitation === null) return { status: "opening" };
    return {
      status: "invited",
      invitedBy: invitation.invitedBy,
      workspace: invitation.tenantId,
      role: roleName ?? invitation.roleId,
      email: invitation.email,
      state: invitation.state,
    };
  };

  return {
    invitation: shown(),
    signedIn: user !== null,
    accepting: busy,
    onAccept: () => void accept(),
    onSignIn: () => navigate("/auth"),
    onOpenProjects: () => navigate("/"),
  };
}
