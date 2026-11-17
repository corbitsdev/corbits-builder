/**
 * The Secrets tab as it looks: the keys plugins saved, a group for the workspace's and then one
 * for each project's, with which plugins use each. A key is replaced in place or revoked; nothing here
 * shows one.
 */
import { useId, useState, type FormEvent } from "react";
import { EmptyState } from "@corbits/react-ui";
import { wording } from "../../config.ts";
import { Banner, Button, QuietState } from "../../components.jsx";
import {
  SettingsInput,
  SettingsRow,
  SettingsRowActions,
  SettingsRowValue,
} from "./settings-row.tsx";
import { SettingsGroup, SettingsLead } from "./settings-section.tsx";

const copy = wording.secrets;

/** A key a plugin saved. */
export type SavedSecret = {
  id: string;
  label: string;
  /** The plugins that use it, by title; empty when none installed does. */
  plugins: readonly string[];
  /** The host it may be sent to. */
  host: string;
};

/** The secrets saved in one place: the workspace, or one project. */
export type SecretGroup = {
  id: string;
  /** The project's name; null for the workspace's, which every project can use. */
  project: string | null;
  secrets: readonly SavedSecret[];
};

export type SecretsSectionViewProps = {
  loading: boolean;
  /** Why the secrets could not be read; what an earlier read found stays under it. */
  fault: string | null;
  /** The workspace's group first, then one per project that has a secret. */
  groups: readonly SecretGroup[];
  /** The secret whose replacement or revocation is on its way to the hub. */
  pending: string | null;
  /** The secret whose key is being replaced, and why the hub refused the last key tried; the
   * host clears it once a new key is saved. */
  replacing: { id: string; refused: string | null } | null;
  /** The person opened or cancelled a replacement. */
  onReplacing: (id: string | null) => void;
  onReplace: (id: string, key: string) => void;
  onRevoke: (id: string) => void;
};

export function SecretsSectionView({
  loading,
  fault,
  groups,
  pending,
  replacing,
  onReplacing,
  onReplace,
  onRevoke,
}: SecretsSectionViewProps) {
  // The row whose menu opened the last replacement, so its button takes focus back when the row returns.
  const [returnTo, setReturnTo] = useState<string | null>(null);
  const shown = groups.filter((group) => group.secrets.length > 0);
  const empty = !loading && fault === null && shown.length === 0;
  return (
    <>
      <SettingsLead>{copy.lead}</SettingsLead>
      {loading ? (
        <div role="status">
          <QuietState tone="loading">{copy.loading}</QuietState>
        </div>
      ) : null}
      {fault === null ? null : <Banner tone="error" title={fault} />}
      {empty ? (
        <EmptyState title={copy.none} description={copy.noneHint} />
      ) : null}
      {shown.map((group) => (
        <SettingsGroup
          key={group.id}
          title={group.project ?? copy.workspace}
          lead={group.project === null ? copy.workspaceNote : copy.projectNote}
        >
          {group.secrets.map((secret) =>
            replacing?.id === secret.id ? (
              <ReplaceSecret
                key={secret.id}
                secret={secret}
                saving={pending === secret.id}
                refused={replacing.refused}
                onSave={(key) => onReplace(secret.id, key)}
                onCancel={() => onReplacing(null)}
              />
            ) : (
              <SettingsRow
                key={secret.id}
                label={secret.label}
                hint={hint(secret)}
              >
                <SettingsRowActions
                  label={copy.options(secret.label)}
                  editLabel={copy.replace}
                  dangerLabel={copy.revoke}
                  confirmLabel={copy.confirmRevoke}
                  editable
                  busy={pending === secret.id}
                  autoFocus={returnTo === secret.id}
                  onEdit={() => {
                    setReturnTo(secret.id);
                    onReplacing(secret.id);
                  }}
                  onConfirm={() => onRevoke(secret.id)}
                />
              </SettingsRow>
            ),
          )}
        </SettingsGroup>
      ))}
    </>
  );
}

function hint(secret: SavedSecret) {
  return `${copy.usedBy(secret.plugins)} · ${secret.host}`;
}

/** The row while its key is being replaced; what is typed stays in this form's state. */
function ReplaceSecret({
  secret,
  saving,
  refused,
  onSave,
  onCancel,
}: {
  secret: SavedSecret;
  saving: boolean;
  refused: string | null;
  onSave: (key: string) => void;
  onCancel: () => void;
}) {
  const id = useId();
  const [key, setKey] = useState("");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSave(key.trim());
  };
  return (
    <form onSubmit={submit}>
      <SettingsRow
        label={secret.label}
        htmlFor={id}
        hint={[
          hint(secret),
          refused === null ? null : (
            <span role="alert">
              <QuietState tone="error">{refused}</QuietState>
            </span>
          ),
        ]}
      >
        <SettingsRowValue>
          <SettingsInput
            id={id}
            type="password"
            autoComplete="off"
            spellCheck={false}
            autoFocus
            value={key}
            disabled={saving}
            onChange={(event) => setKey(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape" && !saving) onCancel();
            }}
          />
          <Button onClick={onCancel} disabled={saving}>
            {copy.cancel}
          </Button>
          <Button
            type="submit"
            variant="primary"
            loading={saving}
            disabled={key.trim() === ""}
          >
            {saving ? copy.saving : copy.save}
          </Button>
        </SettingsRowValue>
      </SettingsRow>
    </form>
  );
}
