/**
 * Model profiles: the model and effort of each tier; config pins every role to a tier.
 *
 * The shipped profiles, roles, providers and efforts are the hub's config (`/settings/models`)
 * and read-only. The active profile and the profiles a person made are their own settings
 * (`/settings/me`, field `models`). With no active profile, projects run on the only connected
 * provider's (`automaticProfile`); with several connected, the person picks one here. A new
 * project keeps the bindings it started with, so a change here never alters a running project.
 */
import { wording } from "../config.ts";
import { Input, Section } from "@corbits/react-ui";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFieldLabel,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@corbits/react-ui/ui/dialog";
import { useEffect, useState } from "react";
import type {
  CustomProfile,
  ModelCatalog,
  ModelChoice,
  RoleBinding,
  Tier,
} from "@corbits-builder/schemas/models";
import { Banner, Button, QuietSelect, QuietState } from "../components.jsx";
import { productClient } from "../api/transport.ts";
import { workspaceTenantId } from "../api/auth.ts";
import { useModelCatalog } from "./providers.jsx";

const copy = wording.profiles;

type Field = { value: ModelChoice | null; version: number };
type Tiers = CustomProfile["tiers"];
type Profile = {
  id: string;
  label: string;
  hint?: string;
  tiers: Tiers;
  custom: boolean;
};
type Draft = {
  label: string;
  tiers: Partial<Record<Tier, Partial<RoleBinding>>>;
};
type Editing = { mode: "new" } | { mode: "edit"; profile: CustomProfile };

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export function connected(catalog: ModelCatalog, provider: string): boolean {
  return (
    catalog.providers
      .find((entry) => entry.id === provider)
      ?.connections.some(
        (connection) =>
          connection.status === "connected" ||
          // A custom endpoint is never probed on read, so its key being set is what is known.
          (connection.status === undefined && connection.credentialSet),
      ) ?? false
  );
}

function complete(draft: Draft, tiers: readonly Tier[]): Tiers | null {
  const done: Partial<Record<Tier, RoleBinding>> = {};
  for (const tier of tiers) {
    const { provider, model, effort } = draft.tiers[tier] ?? {};
    if (!provider || !model || !effort) return null;
    done[tier] = { provider, model, effort };
  }
  return done as Tiers;
}

export function Profiles() {
  const catalog = useModelCatalog();
  const [field, setField] = useState<Field | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);
  useEffect(() => {
    void workspaceTenantId()
      .then((tenantId) => productClient().personalSettings(tenantId))
      .then((record) =>
        setField(record.fields.models ?? { value: null, version: 0 }),
      )
      .catch((cause: unknown) => setError(message(cause)));
  }, []);

  const save = async (choice: ModelChoice) => {
    if (!field) return false;
    try {
      const receipt = await productClient().savePersonalSettings(
        await workspaceTenantId(),
        {
          command: "save_settings",
          idempotencyKey: crypto.randomUUID(),
          fields: { models: { value: choice, baseVersion: field.version } },
        },
      );
      setField(receipt.record.fields.models ?? field);
      setError(receipt.conflicts.length ? wording.message.stepFailed : null);
      return receipt.conflicts.length === 0;
    } catch (cause) {
      setError(message(cause));
      return false;
    }
  };

  const data = catalog.data;
  if (!data || !field)
    return (
      <Section title={copy.section} description={copy.lead}>
        {catalog.error ? (
          <Banner tone="error" title={message(catalog.error)} />
        ) : null}
        {error ? <Banner tone="error" title={error} /> : null}
      </Section>
    );

  const custom = field.value?.custom ?? [];
  const profiles: Profile[] = [
    ...data.profiles.map((entry) => ({ ...entry, custom: false })),
    ...custom.map((entry) => ({ ...entry, custom: true })),
  ];
  const active =
    profiles.find((entry) => entry.id === field.value?.profile) ??
    profiles.find((entry) => entry.id === data.automaticProfile);
  const viewed = profiles.find((entry) => entry.id === viewing) ?? active;
  const choice = (
    profile: string | undefined,
    list: CustomProfile[],
  ): ModelChoice => ({
    ...(profile ? { profile } : {}),
    ...(list.length ? { custom: list } : {}),
  });
  const available = (tiers: Tiers) =>
    Object.values(tiers).every((binding) => connected(data, binding.provider));

  return (
    <>
      <Section
        title={copy.section}
        description={copy.lead}
        action={
          <Button onClick={() => setEditing({ mode: "new" })}>
            {copy.newProfile}
          </Button>
        }
      >
        <div className="section-body">
          {!active && data.unresolved ? (
            <Banner title={data.unresolved.message} />
          ) : null}
          {profiles.map((profile) => (
            <div key={profile.id} className="row">
              <div className="k">
                <b>{profile.label}</b>
                <span>
                  {!available(profile.tiers)
                    ? copy.unavailable
                    : profile.custom
                      ? copy.yours
                      : profile.hint}
                </span>
              </div>
              <span className="v">
                {profile.custom ? (
                  <>
                    <Button
                      variant="ghost"
                      onClick={() =>
                        setEditing({
                          mode: "edit",
                          profile: custom.find(
                            (entry) => entry.id === profile.id,
                          )!,
                        })
                      }
                    >
                      {copy.edit}
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => {
                        const rest = custom.filter(
                          (entry) => entry.id !== profile.id,
                        );
                        void save(
                          choice(
                            profile.id === field.value?.profile
                              ? undefined
                              : field.value?.profile,
                            rest,
                          ),
                        );
                      }}
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
                {profile.id === active?.id ? (
                  <QuietState tone="success">{copy.active}</QuietState>
                ) : (
                  <Button onClick={() => void save(choice(profile.id, custom))}>
                    {copy.use}
                  </Button>
                )}
              </span>
            </div>
          ))}
          {error ? <Banner tone="error" title={error} /> : null}
        </div>
      </Section>
      {viewed ? (
        <Section title={copy.detail(viewed.label)}>
          <div className="section-body">
            {data.tiers.map((tier) => {
              const binding = viewed.tiers[tier.id];
              const provider = data.providers.find(
                (entry) => entry.id === binding.provider,
              );
              const model = provider?.models.find(
                (entry) => entry.id === binding.model,
              );
              const effort = data.efforts.find(
                (entry) => entry.id === binding.effort,
              );
              const roles = data.roles.filter((role) => role.tier === tier.id);
              return (
                <div key={tier.id} className="row">
                  <div className="k">
                    <b>{copy.tier(tier.label)}</b>
                    <span>{copy.usedBy(roles.map((role) => role.label))}</span>
                  </div>
                  <span className="v">
                    {copy.binding(
                      model?.label ?? binding.model,
                      data.providers.length > 1
                        ? (provider?.label ?? binding.provider)
                        : null,
                      effort?.label ?? binding.effort,
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        </Section>
      ) : null}
      {editing ? (
        <ProfileEditor
          catalog={data}
          profiles={profiles}
          editing={editing}
          onClose={() => setEditing(null)}
          onSave={async (profile) => {
            const list =
              editing.mode === "edit"
                ? custom.map((entry) =>
                    entry.id === profile.id ? profile : entry,
                  )
                : [...custom, profile];
            if (await save(choice(field.value?.profile, list)))
              setEditing(null);
          }}
        />
      ) : null}
    </>
  );
}

/** The four tiers of one profile; a new one starts blank or from any existing profile. */
function ProfileEditor({
  catalog,
  profiles,
  editing,
  onClose,
  onSave,
}: {
  catalog: ModelCatalog;
  profiles: readonly Profile[];
  editing: Editing;
  onClose: () => void;
  onSave: (profile: CustomProfile) => Promise<void>;
}) {
  const [draft, setDraft] = useState<Draft>(
    editing.mode === "edit"
      ? { label: editing.profile.label, tiers: editing.profile.tiers }
      : { label: "", tiers: {} },
  );
  const [busy, setBusy] = useState(false);
  const filled = complete(
    draft,
    catalog.tiers.map((tier) => tier.id),
  );
  const ready = filled !== null && draft.label.trim().length > 0;
  const setTier = (tier: Tier, binding: Partial<RoleBinding>) =>
    setDraft((current) => ({
      ...current,
      tiers: { ...current.tiers, [tier]: binding },
    }));

  return (
    <Dialog
      open
      onOpenChange={(open) => (open || busy ? undefined : onClose())}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {editing.mode === "new" ? copy.newProfile : copy.editProfile}
          </DialogTitle>
          <DialogDescription>{copy.editorLead}</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!ready || busy) return;
            setBusy(true);
            void onSave({
              id:
                editing.mode === "edit"
                  ? editing.profile.id
                  : `custom_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`,
              label: draft.label.trim(),
              tiers: filled,
            }).finally(() => setBusy(false));
          }}
        >
          <DialogBody className="provider-form">
            {editing.mode === "new" ? (
              <div className="provider-field">
                <DialogFieldLabel htmlFor="profile-start">
                  {copy.startFrom}
                </DialogFieldLabel>
                <QuietSelect
                  id="profile-start"
                  defaultValue=""
                  disabled={busy}
                  onChange={(event) => {
                    const source = profiles.find(
                      (entry) => entry.id === event.target.value,
                    );
                    setDraft({
                      label: source ? copy.copyName(source.label) : draft.label,
                      tiers: source ? source.tiers : {},
                    });
                  }}
                >
                  <option value="">{copy.blank}</option>
                  {profiles.map((profile) => (
                    <option key={profile.id} value={profile.id}>
                      {profile.label}
                    </option>
                  ))}
                </QuietSelect>
              </div>
            ) : null}
            <div className="provider-field">
              <DialogFieldLabel htmlFor="profile-name">
                {copy.name}
              </DialogFieldLabel>
              <Input
                id="profile-name"
                autoComplete="off"
                value={draft.label}
                disabled={busy}
                onChange={(event) =>
                  setDraft({ ...draft, label: event.target.value })
                }
              />
            </div>
            {catalog.tiers.map((tier) => {
              const binding = draft.tiers[tier.id] ?? {};
              const provider = catalog.providers.find(
                (entry) => entry.id === binding.provider,
              );
              return (
                <fieldset
                  key={tier.id}
                  className="profile-role"
                  disabled={busy}
                >
                  <legend>{copy.tier(tier.label)}</legend>
                  <QuietSelect
                    aria-label={copy.provider(copy.tier(tier.label))}
                    value={binding.provider ?? ""}
                    onChange={(event) => {
                      const model = catalog.providers.find(
                        (entry) => entry.id === event.target.value,
                      )?.models[0]?.id;
                      const { model: _previous, ...rest } = binding;
                      setTier(tier.id, {
                        ...rest,
                        provider: event.target.value,
                        ...(model ? { model } : {}),
                      });
                    }}
                  >
                    <option value="" disabled>
                      {copy.choose}
                    </option>
                    {catalog.providers.map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {connected(catalog, entry.id)
                          ? entry.label
                          : copy.unavailableOption(entry.label)}
                      </option>
                    ))}
                  </QuietSelect>
                  <QuietSelect
                    aria-label={copy.model(copy.tier(tier.label))}
                    value={binding.model ?? ""}
                    disabled={!provider}
                    onChange={(event) =>
                      setTier(tier.id, {
                        ...binding,
                        model: event.target.value,
                      })
                    }
                  >
                    <option value="" disabled>
                      {copy.choose}
                    </option>
                    {provider?.models.map((model) => (
                      <option key={model.id} value={model.id}>
                        {model.label ?? model.id}
                      </option>
                    ))}
                  </QuietSelect>
                  <QuietSelect
                    aria-label={copy.effort(copy.tier(tier.label))}
                    value={binding.effort ?? ""}
                    onChange={(event) =>
                      setTier(tier.id, {
                        ...binding,
                        effort: event.target.value as RoleBinding["effort"],
                      })
                    }
                  >
                    <option value="" disabled>
                      {copy.choose}
                    </option>
                    {catalog.efforts.map((effort) => (
                      <option key={effort.id} value={effort.id}>
                        {copy.effortOption(effort.label)}
                      </option>
                    ))}
                  </QuietSelect>
                </fieldset>
              );
            })}
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" disabled={busy} onClick={onClose}>
              {wording.action.cancel}
            </Button>
            <Button
              variant="primary"
              type="submit"
              loading={busy}
              disabled={!ready}
            >
              {copy.save}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
