/**
 * The model profile in the new-project prompt box. A new project starts on the one picked here:
 * the person's active profile, else the only connected provider's, else the first profile that can
 * run, until they pick another. Its bindings never change once it starts. With no runnable
 * profile, nothing is picked and the hub says why.
 */
import {
  PromptInputModelSelect,
  type PromptInputModelOption,
} from "@corbits/react-ui";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import type {
  CustomProfile,
  ModelCatalog,
  ModelChoice,
  ModelProvider,
} from "@corbits-builder/schemas/models";
import { wording } from "../config.ts";
import { keys } from "../queries/keys.ts";
import { workspaceTenantId } from "../api/auth.ts";
import { productClient } from "../api/transport.ts";
import { available } from "./profiles.jsx";
import { ReconnectProviderButton, useModelCatalog } from "./providers.jsx";

const copy = wording.profiles;

type Shipped = ModelCatalog["profiles"][number];

/** A profile listed under the provider its medium tier runs on. */
function option(
  catalog: ModelCatalog,
  profile: Shipped | CustomProfile,
): PromptInputModelOption {
  const provider = profile.tiers.medium.provider;
  const group = catalog.providers.find((entry) => entry.id === provider)?.label;
  return {
    id: profile.id,
    name: profile.label,
    detail: "hint" in profile ? profile.hint : copy.yours,
    ...(group ? { group } : {}),
  };
}

/** The shipped profiles, then the person's, each runnable on a connected provider. */
export function profileOptions(
  catalog: ModelCatalog,
  choice: ModelChoice | null,
) {
  return [
    ...catalog.profiles.filter((profile) => profile.available),
    ...(choice?.custom ?? []).filter((profile) =>
      available(catalog, profile.tiers),
    ),
  ].map((profile) => option(catalog, profile));
}

export function useModelChoice() {
  return useQuery({
    queryKey: keys.modelChoice,
    queryFn: async () =>
      (await productClient().personalSettings(await workspaceTenantId())).fields
        .models?.value ?? null,
  });
}

function isProviderRefused(provider: ModelProvider): boolean {
  return (
    !provider.connections.some(
      (connection) => connection.status === "connected",
    ) &&
    provider.connections.some((connection) => connection.status === "refused")
  );
}

/** The provider whose refused credential blocks the person's chosen profile, or any refused provider when none can run. */
export function refusedProviderFor(
  catalog: ModelCatalog | undefined,
  choice: ModelChoice | null | undefined,
  hasRunnableProfile: boolean,
): ModelProvider | undefined {
  if (!catalog) return undefined;
  const targetId = choice?.profile ?? catalog.automaticProfile;
  if (targetId) {
    const profile =
      choice?.custom?.find((entry) => entry.id === targetId) ??
      catalog.profiles.find((entry) => entry.id === targetId);
    if (profile) {
      for (const binding of Object.values(profile.tiers)) {
        const provider = catalog.providers.find(
          (entry) => entry.id === binding.provider,
        );
        if (provider && isProviderRefused(provider)) return provider;
      }
    }
  }
  if (!hasRunnableProfile) {
    return catalog.providers.find(isProviderRefused);
  }
  return undefined;
}

/** Picks the profile a new project starts on, from the person's active one. */
export function NewProjectProfile({
  value,
  onValueChange,
}: {
  value: string | undefined;
  onValueChange: (profile: string) => void;
}) {
  const catalog = useModelCatalog().data;
  const choice = useModelChoice().data;
  const models =
    catalog && choice !== undefined ? profileOptions(catalog, choice) : [];
  const active = choice?.profile ?? catalog?.automaticProfile;
  const shown =
    models.find((model) => model.id === active)?.id ?? models[0]?.id;
  const selected = models.find((model) => model.id === value)?.id ?? shown;
  const refused = refusedProviderFor(catalog, choice, shown !== undefined);
  useEffect(() => {
    if (selected !== undefined && value !== selected) onValueChange(selected);
  }, [value, selected, onValueChange]);
  if (selected === undefined && refused === undefined) return null;
  return (
    <>
      {selected === undefined ? null : (
        <PromptInputModelSelect
          label={copy.pick}
          models={models}
          value={selected}
          onValueChange={onValueChange}
        />
      )}
      {refused === undefined ? null : (
        <ReconnectProviderButton
          provider={refused}
          onConnected={() => {
            if (active !== undefined) onValueChange(active);
          }}
        />
      )}
    </>
  );
}
