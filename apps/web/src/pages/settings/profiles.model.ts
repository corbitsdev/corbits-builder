/**
 * Model profiles: the model and effort of each tier; config pins every role to a tier.
 *
 * The shipped profiles, roles, providers and efforts are the hub's config (`/settings/models`)
 * and read-only. The active profile and the profiles a person made are their own settings
 * (`/settings/me`, field `models`). With no active profile, projects run on the only connected
 * provider's (`automaticProfile`); with several connected, the person picks one here. A new
 * project keeps the bindings it started with, so a change here never alters a running project.
 */
import { wording } from "../../config.ts";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type {
  CustomProfile,
  ModelCatalog,
  ModelChoice,
  RoleBinding,
  Tier,
} from "@corbits-builder/schemas/models";
import { keys } from "../../queries/keys.ts";
import { productClient } from "../../api/transport.ts";
import { workspaceTenantId } from "../../api/auth.ts";
import { message, useModelCatalog } from "./model-catalog.ts";
import type {
  EditorTier,
  ProfileEditorProps,
  ProfilesViewProps,
  TierBinding,
} from "./profiles.view.tsx";

const copy = wording.profiles;
const NO_CUSTOM_PROFILES: CustomProfile[] = [];

type ChoiceField = { value: ModelChoice | null; version: number };
export type ProfilesProps = { initialField?: ChoiceField };
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
/** The open editor: what it is changing, and what has been entered so far. */
type Editor = { editing: Editing; draft: Draft; makeDefault: boolean };

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

export function available(catalog: ModelCatalog, tiers: Tiers): boolean {
  return Object.values(tiers).every((binding) =>
    connected(catalog, binding.provider),
  );
}

export function editorProviders(catalog: ModelCatalog, current?: string) {
  return catalog.providers.filter(
    (entry) => connected(catalog, entry.id) || entry.id === current,
  );
}

function complete(draft: Draft, tiers: readonly Tier[]): Tiers | null {
  const done: Partial<Record<Tier, RoleBinding>> = {};
  for (const tier of tiers) {
    const binding = draft.tiers[tier];
    if (binding === undefined) return null;
    const { provider, model, effort } = binding;
    if (!provider || !model || !effort) return null;
    done[tier] = { provider, model, effort };
  }
  return done as Tiers;
}

/** What each tier of a profile runs, by the names the catalog gives them. */
export function tierBindings(
  catalog: ModelCatalog,
  tiers: Tiers,
): TierBinding[] {
  return catalog.tiers.map((tier) => {
    const binding = tiers[tier.id];
    const provider = catalog.providers.find(
      (entry) => entry.id === binding.provider,
    );
    const model = provider?.models.find((entry) => entry.id === binding.model);
    const effort = catalog.efforts.find((entry) => entry.id === binding.effort);
    const roles = catalog.roles.filter((role) => role.tier === tier.id);
    return {
      id: tier.id,
      label: tier.label,
      roles: roles.map((role) => role.label),
      model: model?.label ?? binding.model,
      provider:
        catalog.providers.length > 1
          ? (provider?.label ?? binding.provider)
          : null,
      effort: effort?.label ?? binding.effort,
    };
  });
}

/** Each tier of the profile being edited: what is chosen so far, and what can be. */
function editorTiers(catalog: ModelCatalog, draft: Draft): EditorTier[] {
  return catalog.tiers.map((tier) => {
    const binding = draft.tiers[tier.id];
    const provider = catalog.providers.find(
      (entry) => entry.id === binding?.provider,
    );
    return {
      id: tier.id,
      label: tier.label,
      provider: binding?.provider,
      providers: editorProviders(catalog, binding?.provider).map((entry) => ({
        id: entry.id,
        label: entry.label,
        connected: connected(catalog, entry.id),
      })),
      model: binding?.model,
      models: provider
        ? provider.models.map((model) => ({
            id: model.id,
            label: model.label ?? model.id,
          }))
        : null,
      effort: binding?.effort,
    };
  });
}

export function useProfiles({
  initialField,
}: ProfilesProps): ProfilesViewProps {
  const catalog = useModelCatalog();
  const queryClient = useQueryClient();
  const [field, setField] = useState<ChoiceField | null>(initialField ?? null);
  const [error, setError] = useState<string | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (initialField) return;
    const readField = async () => {
      try {
        const record = await productClient().personalSettings(
          await workspaceTenantId(),
        );
        setField(record.fields.models ?? { value: null, version: 0 });
      } catch (cause) {
        setError(message(cause));
      }
    };
    void readField();
  }, [initialField]);

  const data = catalog.data;
  if (!data || !field)
    return {
      profilesFault: catalog.error ? message(catalog.error) : null,
      choiceFault: error,
      list: null,
      editor: null,
    };

  const save = async (choice: ModelChoice) => {
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
      void queryClient.invalidateQueries({ queryKey: keys.modelChoice });
      setError(receipt.conflicts.length ? wording.message.stepFailed : null);
      return receipt.conflicts.length === 0;
    } catch (cause) {
      setError(message(cause));
      return false;
    }
  };

  const custom = field.value?.custom ?? NO_CUSTOM_PROFILES;
  const profiles: Profile[] = [
    ...data.profiles.map((entry) => ({ ...entry, custom: false })),
    ...custom.map((entry) => ({ ...entry, custom: true })),
  ];
  const active =
    profiles.find(
      (entry) =>
        entry.id === field.value?.profile && available(data, entry.tiers),
    ) ??
    profiles.find(
      (entry) =>
        entry.id === data.automaticProfile && available(data, entry.tiers),
    );
  const choice = (
    profile: string | undefined,
    list: CustomProfile[],
  ): ModelChoice => ({
    ...(profile ? { profile } : {}),
    ...(list.length ? { custom: list } : {}),
  });

  const editorProps = (open: Editor): ProfileEditorProps => {
    const { editing, draft, makeDefault } = open;
    const setDraft = (next: Draft) => setEditor({ ...open, draft: next });
    const setTier = (tier: Tier, binding: Partial<RoleBinding>) =>
      setDraft({ ...draft, tiers: { ...draft.tiers, [tier]: binding } });
    const filled = complete(
      draft,
      data.tiers.map((tier) => tier.id),
    );
    const ready =
      filled !== null &&
      draft.label.trim().length > 0 &&
      available(data, filled);
    const replacing = editing.mode === "new" ? (active?.label ?? null) : null;

    const saveProfile = async () => {
      if (!ready || busy || filled === null) return;
      const profile: CustomProfile = {
        id:
          editing.mode === "edit"
            ? editing.profile.id
            : `custom_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`,
        label: draft.label.trim(),
        tiers: filled,
      };
      const list =
        editing.mode === "edit"
          ? custom.map((entry) => (entry.id === profile.id ? profile : entry))
          : [...custom, profile];
      let profileId = field.value?.profile;
      if (replacing !== null && makeDefault) {
        profileId = profile.id;
      } else if (editing.mode === "new") {
        profileId = active?.id ?? field.value?.profile;
      }
      setBusy(true);
      try {
        if (await save(choice(profileId, list))) setEditor(null);
      } finally {
        setBusy(false);
      }
    };

    return {
      mode: editing.mode,
      startFrom: profiles
        .filter((profile) => available(data, profile.tiers))
        .map(({ id, label }) => ({ id, label })),
      onStartFrom: (profileId) => {
        const source = profiles.find((entry) => entry.id === profileId);
        setDraft({
          label: source ? copy.copyName(source.label) : draft.label,
          tiers: source ? source.tiers : {},
        });
      },
      name: draft.label,
      onNameChange: (label) => setDraft({ ...draft, label }),
      tiers: editorTiers(data, draft),
      onProviderChange: (tier, provider) => {
        const model = data.providers.find((entry) => entry.id === provider)
          ?.models[0]?.id;
        const effort = draft.tiers[tier]?.effort;
        setTier(tier, {
          provider,
          ...(effort === undefined ? {} : { effort }),
          ...(model ? { model } : {}),
        });
      },
      onModelChange: (tier, model) =>
        setTier(tier, { ...draft.tiers[tier], model }),
      onEffortChange: (tier, effort) =>
        setTier(tier, {
          ...draft.tiers[tier],
          effort: effort as RoleBinding["effort"],
        }),
      efforts: data.efforts,
      replacing,
      makeDefault,
      onMakeDefaultChange: (on) => setEditor({ ...open, makeDefault: on }),
      saving: busy,
      canSave: ready,
      onSave: () => void saveProfile(),
      onCancel: () => setEditor(null),
    };
  };

  return {
    profilesFault: null,
    choiceFault: error,
    list: {
      profiles: profiles.map((profile) => ({
        id: profile.id,
        label: profile.label,
        hint: profile.hint,
        own: profile.custom,
        active: profile.id === active?.id,
        runnable: available(data, profile.tiers),
        tiers: tierBindings(data, profile.tiers),
      })),
      notice: !active && data.unresolved ? data.unresolved.message : null,
      onNew: () =>
        setEditor({
          editing: { mode: "new" },
          draft: { label: "", tiers: {} },
          makeDefault: false,
        }),
      onEdit: (profileId) => {
        const profile = custom.find((entry) => entry.id === profileId)!;
        setEditor({
          editing: { mode: "edit", profile },
          draft: { label: profile.label, tiers: profile.tiers },
          makeDefault: false,
        });
      },
      onDelete: (profileId) => {
        const rest = custom.filter((entry) => entry.id !== profileId);
        void save(
          choice(profileId === active?.id ? undefined : active?.id, rest),
        );
      },
      onUse: (profileId) => void save(choice(profileId, custom)),
    },
    editor: editor && editorProps(editor),
  };
}
