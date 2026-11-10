/**
 * The Collaborators section as it looks: the person signed in and their roles, the roles an
 * invitation can grant, the form that invites someone, and the invitations still open.
 */
import { wording } from "../../config.ts";
import {
  Banner,
  Button,
  InlineNote,
  QuietSelect,
  StateLabel,
} from "../../components.jsx";
import { Section } from "@corbits/react-ui";
import {
  SettingsInput,
  SettingsRow,
  SettingsRowValue,
} from "./settings-row.tsx";
import { SettingsSectionBody } from "./settings-section.tsx";
import styles from "./collaborators.module.css";

export type CollaboratorsViewProps = {
  /** Why the workspace's roles and invitations could not be read. */
  fault: string | null;
  /** The invitation just made: who it is for, their link, and whether an email went out. */
  notice: string | null;
  /** The person signed in; without one the row names them "You". */
  you: { name: string; email: string } | null;
  /** The names of their roles here; null until they are known. */
  yourRoles: readonly string[] | null;
  /** The roles an invitation can grant; null until they are known. */
  roles:
    | readonly { id: string; name: string; description: string | null }[]
    | null;
  /** The invitation being written: who it goes to and the role it grants. */
  email: string;
  onEmailChange: (email: string) => void;
  roleId: string;
  onRoleChange: (roleId: string) => void;
  /** An invitation is being made or revoked; the form and each Revoke wait. */
  busy: boolean;
  /** The invitation has an email and a role, so it can be sent. */
  canInvite: boolean;
  onInvite: () => void;
  /** The invitations nobody has accepted yet. */
  invitations: readonly {
    id: string;
    email: string;
    /** How long the link still works, such as "3 days left". */
    expires: string;
  }[];
  onRevoke: (invitationId: string) => void;
};

function names(list: readonly string[] | null, none: string): string {
  if (list === null) return "…";
  return list.length > 0 ? list.join(", ") : none;
}

export function CollaboratorsView({
  fault,
  notice,
  you,
  yourRoles,
  roles,
  email,
  onEmailChange,
  roleId,
  onRoleChange,
  busy,
  canInvite,
  onInvite,
  invitations,
  onRevoke,
}: CollaboratorsViewProps) {
  return (
    <Section
      title="Collaborators"
      description="Who works in this workspace, and what they may do."
    >
      <SettingsSectionBody>
        {fault ? <Banner tone="error" title={fault} /> : null}
        {notice ? <Banner tone="okay" title={notice} /> : null}
        <SettingsRow
          label={you ? you.name : wording.speaker.you}
          hint={you?.email}
        >
          <SettingsRowValue>{names(yourRoles, "Member")}</SettingsRowValue>
        </SettingsRow>
        <SettingsRow
          label="Workspace roles"
          hint="What an invitation can grant. Names and grants come from the hub."
        >
          <SettingsRowValue>
            {names(
              roles === null ? null : roles.map((role) => role.name),
              "None defined yet.",
            )}
          </SettingsRowValue>
        </SettingsRow>
        <SettingsRow
          label="Invite a collaborator"
          hint="They appear here once they accept their link."
        >
          <SettingsRowValue>
            {roles !== null && roles.length > 0 ? (
              <span className={styles.inviteForm}>
                <SettingsInput
                  type="email"
                  aria-label="Their email"
                  placeholder="name@example.com"
                  value={email}
                  disabled={busy}
                  onChange={(event) => onEmailChange(event.target.value)}
                />
                <QuietSelect
                  aria-label="Role"
                  value={roleId}
                  disabled={busy}
                  onChange={(event) => onRoleChange(event.target.value)}
                >
                  <option value="" disabled>
                    Choose a role…
                  </option>
                  {roles.map((role) => (
                    <option key={role.id} value={role.id}>
                      {role.name}
                      {role.description ? ` — ${role.description}` : ""}
                    </option>
                  ))}
                </QuietSelect>
                <Button
                  variant="primary"
                  disabled={busy || !canInvite}
                  onClick={onInvite}
                >
                  {busy ? "Inviting…" : "Invite"}
                </Button>
              </span>
            ) : (
              "No roles are defined yet, so there is nothing to invite into."
            )}
          </SettingsRowValue>
        </SettingsRow>
        {invitations.length > 0 ? (
          <SettingsRow
            label="Open invitations"
            hint="Each is a link the invited person accepts from."
          >
            <SettingsRowValue>
              {invitations.map((invitation) => (
                <span key={invitation.id}>
                  <span>
                    {invitation.email} · {invitation.expires}
                  </span>
                  <StateLabel tone="info">pending</StateLabel>
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() => onRevoke(invitation.id)}
                  >
                    Revoke
                  </Button>
                </span>
              ))}
            </SettingsRowValue>
          </SettingsRow>
        ) : null}
        <InlineNote>
          A full member directory is not part of this workspace yet: the hub
          lists your own memberships, not every principal, so only you and open
          invitations are shown.
        </InlineNote>
      </SettingsSectionBody>
    </Section>
  );
}
