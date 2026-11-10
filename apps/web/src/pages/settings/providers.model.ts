/**
 * What the Providers section does: reads which providers exist and what their last check found
 * from the hub's config through `/settings/models`, and opens the one dialog that adds another.
 */
import { useState } from "react";
import type {
  ModelCatalog,
  ModelProvider,
} from "@corbits-builder/schemas/models";
import type { AddProviderDialogProps } from "./add-provider-dialog.model.ts";
import {
  message,
  useModelCatalog,
  useSubscriptionLogins,
} from "./model-catalog.ts";
import type {
  KeyConnection,
  ProvidersSectionViewProps,
} from "./providers.view.tsx";

/** A custom endpoint among the connections, which has a row of its own for the page to draw. */
type CustomConnection = { id: string; custom: ModelProvider };

function keyConnection(
  provider: ModelProvider,
  connection: ModelProvider["connections"][number],
): KeyConnection {
  return {
    id: connection.id,
    name: connection.name,
    provider: connection.name === provider.label ? null : provider.label,
    source: connection.note ?? null,
    status: connection.status ?? null,
  };
}

/** The providers connected by a key, in the catalog's order. */
function keyConnections(
  catalog: ModelCatalog,
): (KeyConnection | CustomConnection)[] {
  return catalog.providers
    .filter((provider) => provider.kind !== "login")
    .flatMap((provider) =>
      provider.connections.map((connection) =>
        provider.kind === "custom"
          ? { id: connection.id, custom: provider }
          : keyConnection(provider, connection),
      ),
    );
}

export function useProvidersSection(onChanged: () => void): {
  view: Omit<ProvidersSectionViewProps, "connections" | "addDialog">;
  connections: readonly (KeyConnection | CustomConnection)[];
  addDialog: AddProviderDialogProps;
} {
  const catalog = useModelCatalog();
  const { logins, signingIn, signIn } = useSubscriptionLogins(onChanged);
  const [adding, setAdding] = useState(false);

  return {
    view: {
      loading: catalog.isPending,
      fault: catalog.error ? message(catalog.error) : null,
      logins: logins.map((provider) => ({
        id: provider.id,
        name: provider.label,
        connected: provider.connections.some(
          (connection) => connection.status === "connected",
        ),
      })),
      signingIn,
      onSignIn: (id) => void signIn(id),
      onAdd: () => setAdding(true),
    },
    connections: catalog.data === undefined ? [] : keyConnections(catalog.data),
    addDialog: {
      open: adding,
      onOpenChange: setAdding,
      onConnected: onChanged,
    },
  };
}
