/**
 * The Profiles section as it looks: the list of profiles, what the one being looked at runs on
 * each tier, and the dialog that makes or changes a profile of the person's own.
 */
import { wording } from "../../config.ts";
import { Input, Section, Switch } from "@corbits/react-ui";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFieldLabel,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@corbits/react-ui/ui/dialog";
import { useState } from "react";
import type { Tier } from "@corbits-builder/schemas/models";
import {
  Banner,
  Button,
  Field,
  QuietSelect,
  QuietState,
} from "../../components.jsx";
import { ProviderFormBody } from "./provider-form.tsx";
import { SettingsRow, SettingsRowValue } from "./settings-row.tsx";
import { SettingsSectionBody } from "./settings-section.tsx";
import styles from "./profiles.module.css";

const copy = wording.profiles;
// The value of each tier select's disabled placeholder, which shows until a choice is made.
const CHOOSE = "";

/** What one tier of a profile runs, by name. */
export type TierBinding = {
  id: Tier;
  label: string;
  /** The roles that run on this tier. */
  roles: readonly string[];
  model: string;
  /** Null where only one provider exists, so naming it says nothing. */
  provider: string | null;
  effort: string;
};

export type ProfileRow = {
  id: string;
  label: string;
  /** What a shipped profile is for; the person's own have none. */
  hint: string | undefined;
  /** The person made it, so they can edit and delete it. */
  own: boolean;
  /** New projects start on it. */
  active: boolean;
  /** Its providers are connected, so a project can start on it. */
  runnable: boolean;
  tiers: readonly TierBinding[];
};

/** One tier in the editor: what is chosen, and what can be. Nothing chosen is "". */
export type EditorTier = {
  id: Tier;
  label: string;
  /** Undefined until one is chosen, as are the model and effort. */
  provider: string | undefined;
  providers: readonly { id: string; label: string; connected: boolean }[];
  model: string | undefined;
  /** The chosen provider's models; null until a provider is chosen. */
  models: readonly { id: string; label: string }[] | null;
  effort: string | undefined;
};

export type ProfileEditorProps = {
  /** A new profile, or one of the person's own being changed. */
  mode: "new" | "edit";
  /** The profiles a new one can start as a copy of. */
  startFrom: readonly { id: string; label: string }[];
  /** Copies that profile into the editor; "" starts blank. */
  onStartFrom: (profileId: string) => void;
  name: string;
  onNameChange: (name: string) => void;
  tiers: readonly EditorTier[];
  onProviderChange: (tier: Tier, provider: string) => void;
  onModelChange: (tier: Tier, model: string) => void;
  onEffortChange: (tier: Tier, effort: string) => void;
  efforts: readonly { id: string; label: string }[];
  /** Label of the current default, when a new profile can replace it. */
  replacing: string | null;
  makeDefault: boolean;
  onMakeDefaultChange: (makeDefault: boolean) => void;
  saving: boolean;
  /** Every tier is filled in on a connected provider and the profile has a name. */
  canSave: boolean;
  onSave: () => void;
  onCancel: () => void;
};

export type ProfilesViewProps = {
  /** Why the profiles could not be read. */
  profilesFault: string | null;
  /** Why the person's choice of profile could not be read or saved. */
  choiceFault: string | null;
  /** The profiles and what can be done with them; null until they have been read. */
  list: {
    profiles: readonly ProfileRow[];
    /** Why no profile is active, when the person has to pick one. */
    notice: string | null;
    onNew: () => void;
    onEdit: (profileId: string) => void;
    onDelete: (profileId: string) => void;
    onUse: (profileId: string) => void;
  } | null;
  /** The dialog that makes or changes a profile; null while it is closed. */
  editor: ProfileEditorProps | null;
};

function profileSubtitle(profile: ProfileRow) {
  if (!profile.runnable) return copy.unavailable;
  return profile.own ? copy.yours : profile.hint;
}

export function ProfilesView({
  profilesFault,
  choiceFault,
  list,
  editor,
}: ProfilesViewProps) {
  const [viewing, setViewing] = useState<string | null>(null);
  if (list === null)
    return (
      <Section title={copy.section} description={copy.lead}>
        {profilesFault ? <Banner tone="error" title={profilesFault} /> : null}
        {choiceFault ? <Banner tone="error" title={choiceFault} /> : null}
      </Section>
    );

  const { profiles, notice, onNew, onEdit, onDelete, onUse } = list;
  const viewed =
    profiles.find((profile) => profile.id === viewing) ??
    profiles.find((profile) => profile.active);

  return (
    <>
      <Section
        title={copy.section}
        description={copy.lead}
        action={<Button onClick={onNew}>{copy.newProfile}</Button>}
      >
        <SettingsSectionBody>
          {notice ? <Banner title={notice} /> : null}
          {profiles.map((profile) => (
            <SettingsRow
              key={profile.id}
              label={profile.label}
              hint={profileSubtitle(profile)}
            >
              <SettingsRowValue>
                {profile.own ? (
                  <>
                    <Button variant="ghost" onClick={() => onEdit(profile.id)}>
                      {copy.edit}
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => onDelete(profile.id)}
                    >
                      {copy.delete}
                    </Button>
                  </>
                ) : null}
                {profile.id === viewed?.id ? null : (
                  <Button
                    variant="ghost"
                    onClick={() => setViewing(profile.id)}
                  >
                    {copy.show}
                  </Button>
                )}
                {profile.active ? (
                  <QuietState tone="success">{copy.active}</QuietState>
                ) : null}
                {!profile.active && profile.runnable ? (
                  <Button onClick={() => onUse(profile.id)}>{copy.use}</Button>
                ) : null}
              </SettingsRowValue>
            </SettingsRow>
          ))}
          {choiceFault ? <Banner tone="error" title={choiceFault} /> : null}
        </SettingsSectionBody>
      </Section>
      {viewed ? (
        <Section title={copy.detail(viewed.label)}>
          <SettingsSectionBody>
            {viewed.tiers.map((tier) => (
              <SettingsRow
                key={tier.id}
                label={copy.tier(tier.label)}
                hint={copy.usedBy(tier.roles)}
              >
                <SettingsRowValue>
                  {copy.binding(tier.model, tier.provider, tier.effort)}
                </SettingsRowValue>
              </SettingsRow>
            ))}
          </SettingsSectionBody>
        </Section>
      ) : null}
      {editor ? <ProfileEditor {...editor} /> : null}
    </>
  );
}

/** The four tiers of one profile; a new one starts blank or from any existing profile. */
function ProfileEditor({
  mode,
  startFrom,
  onStartFrom,
  name,
  onNameChange,
  tiers,
  onProviderChange,
  onModelChange,
  onEffortChange,
  efforts,
  replacing,
  makeDefault,
  onMakeDefaultChange,
  saving,
  canSave,
  onSave,
  onCancel,
}: ProfileEditorProps) {
  return (
    <Dialog
      open
      onOpenChange={(open) => (open || saving ? undefined : onCancel())}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {mode === "new" ? copy.newProfile : copy.editProfile}
          </DialogTitle>
          <DialogDescription>{copy.editorLead}</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            onSave();
          }}
        >
          <ProviderFormBody>
            {mode === "new" ? (
              <Field>
                <DialogFieldLabel htmlFor="profile-start">
                  {copy.startFrom}
                </DialogFieldLabel>
                <QuietSelect
                  id="profile-start"
                  defaultValue=""
                  disabled={saving}
                  onChange={(event) => onStartFrom(event.target.value)}
                >
                  <option value="">{copy.blank}</option>
                  {startFrom.map((profile) => (
                    <option key={profile.id} value={profile.id}>
                      {profile.label}
                    </option>
                  ))}
                </QuietSelect>
              </Field>
            ) : null}
            <Field>
              <DialogFieldLabel htmlFor="profile-name">
                {copy.name}
              </DialogFieldLabel>
              <Input
                id="profile-name"
                autoComplete="off"
                value={name}
                disabled={saving}
                onChange={(event) => onNameChange(event.target.value)}
              />
            </Field>
            {tiers.map((tier) => (
              <fieldset key={tier.id} className={styles.role} disabled={saving}>
                <legend>{copy.tier(tier.label)}</legend>
                <QuietSelect
                  aria-label={copy.provider(copy.tier(tier.label))}
                  value={tier.provider ?? CHOOSE}
                  onChange={(event) =>
                    onProviderChange(tier.id, event.target.value)
                  }
                >
                  <option value={CHOOSE} disabled>
                    {copy.choose}
                  </option>
                  {tier.providers.map((provider) => (
                    <option
                      key={provider.id}
                      value={provider.id}
                      disabled={!provider.connected}
                    >
                      {provider.connected
                        ? provider.label
                        : copy.unavailableOption(provider.label)}
                    </option>
                  ))}
                </QuietSelect>
                <QuietSelect
                  aria-label={copy.model(copy.tier(tier.label))}
                  value={tier.model ?? CHOOSE}
                  disabled={tier.models === null}
                  onChange={(event) =>
                    onModelChange(tier.id, event.target.value)
                  }
                >
                  <option value={CHOOSE} disabled>
                    {copy.choose}
                  </option>
                  {tier.models?.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.label}
                    </option>
                  ))}
                </QuietSelect>
                <QuietSelect
                  aria-label={copy.effort(copy.tier(tier.label))}
                  value={tier.effort ?? CHOOSE}
                  onChange={(event) =>
                    onEffortChange(tier.id, event.target.value)
                  }
                >
                  <option value={CHOOSE} disabled>
                    {copy.choose}
                  </option>
                  {efforts.map((effort) => (
                    <option key={effort.id} value={effort.id}>
                      {copy.effortOption(effort.label)}
                    </option>
                  ))}
                </QuietSelect>
              </fieldset>
            ))}
            {replacing ? (
              <Field>
                <DialogFieldLabel htmlFor="profile-replace-default">
                  {copy.replaceDefault(replacing)}
                </DialogFieldLabel>
                <Switch
                  id="profile-replace-default"
                  checked={makeDefault}
                  disabled={saving}
                  onCheckedChange={onMakeDefaultChange}
                />
              </Field>
            ) : null}
          </ProviderFormBody>
          <DialogFooter>
            <Button variant="ghost" disabled={saving} onClick={onCancel}>
              {wording.action.cancel}
            </Button>
            <Button
              variant="primary"
              type="submit"
              loading={saving}
              disabled={!canSave}
            >
              {copy.save}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
