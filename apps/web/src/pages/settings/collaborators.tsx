/**
 * Collaborators: who this workspace belongs to, its roles, and its open
 * invitations, from the hub's role, grant and invitation routes through the
 * typed product client.
 *
 * The hub reads only the caller's own memberships (`/api/me/principals`), not
 * a member directory, so this page lists you and every open invitation and
 * says that other members are not listed.
 */
import { wording } from "../../config.ts";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Banner,
  Button,
  InlineNote,
  QuietSelect,
  StateLabel,
} from "../../components.jsx";
import { productClient } from "../../api/transport.ts";
import { workspaceTenantId, type HubUser } from "../../api/auth.ts";
import type { Invitation } from "@corbits-builder/schemas/invitation";
import {
  ProductApiError,
  type ProductApiClient,
} from "@corbits-builder/client";
import { responseCode } from "../workspace/human-fault.ts";
import { Section } from "@corbits/react-ui";
import {
  SettingsInput,
  SettingsRow,
  SettingsRowValue,
} from "./settings-row.tsx";
import { SettingsSectionBody } from "./settings-section.tsx";
import styles from "./collaborators.module.css";

type RoleRow = Awaited<
  ReturnType<ProductApiClient["tenantRoles"]>
>["data"][number];

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

export function Collaborators({ user }: { user: HubUser | null }) {
  const [roles, setRoles] = useState<RoleRow[] | null>(null);
  const [invitations, setInvitations] = useState<Invitation[] | null>(null);
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

  return (
    <Section
      title="Collaborators"
      description="Who works in this workspace, and what they may do."
    >
      <SettingsSectionBody>
        {error ? <Banner tone="error" title={error} /> : null}
        {notice ? <Banner tone="okay" title={notice} /> : null}
        <SettingsRow
          label={user ? user.name : wording.speaker.you}
          hint={user?.email}
        >
          <SettingsRowValue>
            {myRoles === null
              ? "…"
              : myRoles.length > 0
                ? myRoles.join(", ")
                : "Member"}
          </SettingsRowValue>
        </SettingsRow>
        <SettingsRow
          label="Workspace roles"
          hint="What an invitation can grant. Names and grants come from the hub."
        >
          <SettingsRowValue>
            {roles === null
              ? "…"
              : roles.length === 0
                ? "None defined yet."
                : roles.map((role) => role.name).join(", ")}
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
                  onChange={(event) => setEmail(event.target.value)}
                />
                <QuietSelect
                  aria-label="Role"
                  value={roleId}
                  disabled={busy}
                  onChange={(event) => setRoleId(event.target.value)}
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
                  disabled={busy || email.trim() === "" || roleId === ""}
                  onClick={() => void create()}
                >
                  {busy ? "Inviting…" : "Invite"}
                </Button>
              </span>
            ) : (
              "No roles are defined yet, so there is nothing to invite into."
            )}
          </SettingsRowValue>
        </SettingsRow>
        {invitations !== null && invitations.length > 0 ? (
          <SettingsRow
            label="Open invitations"
            hint="Each is a link the invited person accepts from."
          >
            <SettingsRowValue>
              {invitations.map((invitation) => (
                <span key={invitation.id}>
                  <span>
                    {invitation.email} · {expiresInLabel(invitation.expiresAt)}
                  </span>
                  <StateLabel tone="info">{invitation.state}</StateLabel>
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() => void revoke(invitation.id)}
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
