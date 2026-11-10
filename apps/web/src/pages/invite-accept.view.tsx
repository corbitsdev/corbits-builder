/**
 * The invitation accept screen as it looks: who invited the person and into
 * what, with the way to accept, or what became of the invitation instead.
 */
import type { ReactNode } from "react";
import type { Invitation } from "@corbits-builder/schemas/invitation";
import { wording } from "../config.ts";
import { Banner, Button, Mark, StateLabel } from "../components.jsx";

export type InvitationAcceptViewProps = {
  /** The invitation as far as it is known: still being read, unreadable, read, or just accepted. */
  invitation:
    | { status: "opening" }
    | { status: "unreadable"; reason: string }
    | {
        status: "invited";
        invitedBy: string;
        workspace: string;
        role: string;
        email: string;
        /** Only a pending invitation can still be accepted. */
        state: Invitation["state"];
      }
    | {
        status: "accepted";
        /** The role the person now holds, when its name could be read. */
        role: string | null;
      };
  /** Accepting needs an account; without one the screen sends the person to sign in. */
  signedIn: boolean;
  accepting: boolean;
  onAccept: () => void;
  onSignIn: () => void;
  onOpenProjects: () => void;
};

export function InvitationAcceptView({
  invitation,
  signedIn,
  accepting,
  onAccept,
  onSignIn,
  onOpenProjects,
}: InvitationAcceptViewProps) {
  if (invitation.status === "accepted") {
    return (
      <div>
        <Mark size={26} />
        <h1>Welcome in</h1>
        <p>
          You are now a member of this workspace
          {invitation.role !== null ? ` with the ${invitation.role} role` : ""}.
        </p>
        <Button variant="primary" onClick={onOpenProjects}>
          Go to your projects
        </Button>
      </div>
    );
  }

  if (invitation.status === "unreadable") {
    return (
      <div>
        <Mark size={26} />
        <h1>This invitation could not be read</h1>
        <Banner tone="error" title={invitation.reason} />
        <p>Ask the person who invited you for a fresh link.</p>
      </div>
    );
  }

  if (invitation.status === "opening") {
    return (
      <div>
        <Mark size={26} />
        <h1>Opening the invitation…</h1>
      </div>
    );
  }

  const pending = invitation.state === "pending";

  let answer: ReactNode;
  if (!pending)
    answer = (
      <p>
        This invitation is {invitation.state}. Ask the person who invited you
        for a new one.
      </p>
    );
  else if (!signedIn)
    answer = (
      <Banner tone="warning" title="Sign in first">
        <p>
          Accepting needs an account on this hub. Sign in or create one, then
          come back to this link.
        </p>
        <Button variant="primary" onClick={onSignIn}>
          {wording.action.signIn}
        </Button>
      </Banner>
    );
  else
    answer = (
      <Button variant="primary" disabled={accepting} onClick={onAccept}>
        {accepting ? "Accepting…" : "Accept the invitation"}
      </Button>
    );

  return (
    <div>
      <Mark size={26} />
      <h1>You're invited</h1>
      <div>
        <div>
          <div>
            <div>
              <b>Invited by</b>
            </div>
            <span>{invitation.invitedBy}</span>
          </div>
          <div>
            <div>
              <b>Workspace</b>
            </div>
            <span>{invitation.workspace}</span>
          </div>
          <div>
            <div>
              <b>Role</b>
            </div>
            <span>{invitation.role}</span>
          </div>
          <div>
            <div>
              <b>Email</b>
            </div>
            <span>{invitation.email}</span>
          </div>
          <div>
            <div>
              <b>State</b>
            </div>
            <StateLabel tone={pending ? "info" : "warning"}>
              {invitation.state}
            </StateLabel>
          </div>
        </div>
      </div>
      {answer}
    </div>
  );
}
