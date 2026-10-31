/**
 * The model profile in the new-project prompt box. A new project starts on the one picked here
 * (the person's active profile, else the only connected provider's, until they pick another); its
 * bindings never change once it starts. With neither, nothing is picked and the hub says why.
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
} from "@corbits-builder/schemas/models";
import { wording } from "../config.ts";
import { keys } from "../queries/keys.ts";
import { workspaceTenantId } from "../api/auth.ts";
import { productClient } from "../api/transport.ts";
import { connected } from "./profiles.jsx";
import { useModelCatalog } from "./providers.jsx";

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
function profileOptions(catalog: ModelCatalog, choice: ModelChoice | null) {
  return [
    ...catalog.profiles.filter((profile) => profile.available),
    ...(choice?.custom ?? []).filter((profile) =>
      Object.values(profile.tiers).every((binding) =>
        connected(catalog, binding.provider),
      ),
    ),
  ].map((profile) => option(catalog, profile));
}

function useModelChoice() {
  return useQuery({
    queryKey: keys.modelChoice,
    queryFn: async () =>
      (await productClient().personalSettings(await workspaceTenantId())).fields
        .models?.value ?? null,
  });
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
  const shown = models.some((model) => model.id === active)
    ? active
    : undefined;
  useEffect(() => {
    if (value === undefined && shown !== undefined) onValueChange(shown);
  }, [value, shown, onValueChange]);
  if (shown === undefined) return null;
  return (
    <PromptInputModelSelect
      label={copy.pick}
      models={models}
      value={value ?? shown}
      onValueChange={onValueChange}
    />
  );
}
