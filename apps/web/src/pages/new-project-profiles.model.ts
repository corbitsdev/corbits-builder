/**
 * The model profile in the new-project prompt box. A new project starts on the one picked here:
 * the person's active profile, else the only connected provider's, else the first profile that can
 * run, until they pick another. Its bindings never change once it starts. With no runnable
 * profile, nothing is picked and the hub says why.
 */
import type { PromptInputModelOption } from "@corbits/react-ui";
import { useQuery } from "@tanstack/react-query";
import type {
  CustomProfile,
  ModelCatalog,
  ModelChoice,
} from "@corbits-builder/schemas/models";
import { wording } from "../config.ts";
import { keys } from "../queries/keys.ts";
import { workspaceTenantId } from "../api/auth.ts";
import { productClient } from "../api/transport.ts";
import { available } from "./settings/profiles.model.ts";
import { useModelCatalog } from "./settings/model-catalog.ts";

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
      available(catalog, profile.tiers),
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

/** The profiles a new project can start on, and the one it starts on until the person picks. */
export function useNewProjectProfiles(): {
  options: readonly PromptInputModelOption[];
  preferred: string | undefined;
} {
  const catalog = useModelCatalog().data;
  const choice = useModelChoice().data;
  const options =
    catalog && choice !== undefined ? profileOptions(catalog, choice) : [];
  const active = choice?.profile ?? catalog?.automaticProfile;
  return {
    options,
    preferred:
      options.find((option) => option.id === active)?.id ?? options[0]?.id,
  };
}
