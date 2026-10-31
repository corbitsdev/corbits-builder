/**
 * The invitation accept screen, at the invitation's own URL.
 *
 * The hub mints an invitation path on creation; the person who accepts
 * arrives there. This screen reads the invitation record and shows who
 * invited them and into what, then accepts, or reports the invitation's
 * state (expired, revoked, already activated). The hub has no decline
 * endpoint; an unaccepted link expires or is revoked.
 */
import { wording } from "../config.ts";
import { useEffect, useState } from "react";
import { Banner, Button, Mark, StateLabel } from "../components.jsx";
import { productClient } from "../api/transport.ts";
import { getHubSession, type HubUser } from "../api/auth.ts";
import { navigate } from "../routes.ts";
import type { Invitation } from "@corbits-builder/schemas/invitation";

export function InvitationAccept({ invitationId }: { invitationId: string }) {
  const [invitation, setInvitation] = useState<Invitation | null>(null);
  const [roleName, setRoleName] = useState<string | null>(null);
  const [user, setUser] = useState<HubUser | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [accepted, setAccepted] = useState<Invitation | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
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
        } catch {
          // The role name is a courtesy; the accept does not depend on it.
        }
      } catch (cause) {
        if (!cancelled)
          setFailed(cause instanceof Error ? cause.message : String(cause));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [invitationId]);

  const accept = async () => {
    setBusy(true);
    setFailed(null);
    try {
      const result = await productClient().acceptInvitation(invitationId);
      setAccepted(result);
    } catch (cause) {
      setFailed(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  if (accepted !== null) {
    return (
      <div className="invite-accept">
        <Mark size={26} />
        <h1>Welcome in</h1>
        <p>
          You are now a member of this workspace
          {roleName !== null ? ` with the ${roleName} role` : ""}.
        </p>
        <Button variant="primary" onClick={() => navigate("/")}>
          Go to your projects
        </Button>
      </div>
    );
  }

  if (failed !== null) {
    return (
      <div className="invite-accept">
        <Mark size={26} />
        <h1>This invitation could not be read</h1>
        <Banner tone="error" title={failed} />
        <p>Ask the person who invited you for a fresh link.</p>
      </div>
    );
  }

  if (invitation === null) {
    return (
      <div className="invite-accept">
        <Mark size={26} />
        <h1>Opening the invitation…</h1>
      </div>
    );
  }

  const pending = invitation.state === "pending";

  return (
    <div className="invite-accept">
      <Mark size={26} />
      <h1>You're invited</h1>
      <div className="section">
        <div className="section-body">
          <div className="row">
            <div className="k">
              <b>Invited by</b>
            </div>
            <span className="v">{invitation.invitedBy}</span>
          </div>
          <div className="row">
            <div className="k">
              <b>Workspace</b>
            </div>
            <span className="v">{invitation.tenantId}</span>
          </div>
          <div className="row">
            <div className="k">
              <b>Role</b>
            </div>
            <span className="v">{roleName ?? invitation.roleId}</span>
          </div>
          <div className="row">
            <div className="k">
              <b>Email</b>
            </div>
            <span className="v">{invitation.email}</span>
          </div>
          <div className="row">
            <div className="k">
              <b>State</b>
            </div>
            <StateLabel tone={pending ? "info" : "warning"}>
              {invitation.state}
            </StateLabel>
          </div>
        </div>
      </div>
      {invitation.state !== "pending" ? (
        <p>
          This invitation is {invitation.state}. Ask the person who invited you
          for a new one.
        </p>
      ) : user === null ? (
        <Banner tone="warning" title="Sign in first">
          <p>
            Accepting needs an account on this hub. Sign in or create one, then
            come back to this link.
          </p>
          <Button variant="primary" onClick={() => navigate("/auth")}>
            {wording.action.signIn}
          </Button>
        </Banner>
      ) : (
        <Button variant="primary" disabled={busy} onClick={() => void accept()}>
          {busy ? "Accepting…" : "Accept the invitation"}
        </Button>
      )}
    </div>
  );
}
