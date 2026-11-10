/**
 * Model providers: the connected ones with their live status, and the one way to add another.
 *
 * Which providers exist, what they are called and what they need comes from the hub's
 * config through `/settings/models`. A subscription provider is connected by logging in: the hub
 * runs the sign-in, this page opens its authorize URL and waits for the hub to finish. Adding an
 * API-key provider is: pick it, paste its key, test it with one real model-list call, and only a
 * key that passes is saved. A custom endpoint is added from the same dialog and
 * sits in the same list (custom-providers.tsx). Keys live in form state until they are handed
 * over, and nothing here renders a key or token back.
 */
import { AddProviderDialog } from "./add-provider-dialog.tsx";
import { CustomProviderRow } from "./custom-providers.tsx";
import { useProvidersSection } from "./providers.model.ts";
import { ProvidersSectionView } from "./providers.view.tsx";

/** The subscription logins first, then the API-key providers with what their last check found. */
export function ProvidersSection({ onChanged }: { onChanged: () => void }) {
  const { view, connections, addDialog } = useProvidersSection(onChanged);
  return (
    <ProvidersSectionView
      {...view}
      connections={connections.map((connection) =>
        "custom" in connection
          ? {
              id: connection.id,
              endpoint: (
                <CustomProviderRow
                  provider={connection.custom}
                  onChanged={onChanged}
                />
              ),
            }
          : connection,
      )}
      addDialog={<AddProviderDialog {...addDialog} />}
    />
  );
}
