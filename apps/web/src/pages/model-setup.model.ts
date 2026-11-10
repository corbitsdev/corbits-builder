/**
 * Connecting a model provider when no model credential reaches this workspace
 * (its own or the server's): a subscription login signs in through the hub,
 * and an API-key provider opens the Add provider dialog Settings uses.
 */
import { useState } from "react";
import type { AddProviderDialogProps } from "./settings/add-provider-dialog.model.ts";
import {
  useModelCatalog,
  useSubscriptionLogins,
} from "./settings/model-catalog.ts";
import type {
  EnableAiDialogViewProps,
  ModelSetupViewProps,
  ProviderTilesProps,
} from "./model-setup.view.tsx";

export const MODEL_SETUP_LATER_KEY = "sb.model-setup.later";

export function modelSetupDeferred(): boolean {
  try {
    return sessionStorage.getItem(MODEL_SETUP_LATER_KEY) === "1";
  } catch (error) {
    console.warn(
      "Browser storage is unavailable; model setup asks again.",
      error,
    );
    return false;
  }
}

/** Asks again: a newly opened workspace has its own keys to connect. */
export function clearModelSetupDeferral(): void {
  try {
    sessionStorage.removeItem(MODEL_SETUP_LATER_KEY);
  } catch (error) {
    // Unavailable storage never held the deferral either.
    console.warn("Browser storage is unavailable.", error);
  }
}

/** No connection, the workspace's or one it inherits, holds a usable key. An empty read is this case. */
export function needsModelSetup(
  providers: readonly {
    connections: readonly { credentialSet: boolean; status?: string }[];
  }[],
): boolean {
  return !providers.some((provider) =>
    provider.connections.some(
      (connection) =>
        connection.credentialSet && connection.status !== "unavailable",
    ),
  );
}

function useProviderTiles(onConnected: () => void): {
  providers: ProviderTilesProps;
  /** What the Add provider dialog needs, opened for the API-key provider whose tile was picked. */
  providerDialog: AddProviderDialogProps;
} {
  const catalog = useModelCatalog();
  const { logins, signingIn, signIn } = useSubscriptionLogins(onConnected);
  const [keyOpen, setKeyOpen] = useState(false);
  const [keyProviderId, setKeyProviderId] = useState<string>();
  return {
    providers: {
      fault: catalog.error ? catalog.error.message : null,
      // No tiles until the catalog says which providers exist; a failed refetch keeps the last read.
      tiles:
        catalog.data === undefined
          ? null
          : {
              logins,
              apiKeys: catalog.data.providers.filter(
                (provider) => provider.kind === "api_key",
              ),
            },
      signingIn,
      onSignIn: (id) => void signIn(id),
      onAddKey: (id) => {
        setKeyProviderId(id);
        setKeyOpen(true);
      },
    },
    providerDialog: {
      providerId: keyProviderId,
      open: keyOpen,
      onOpenChange: setKeyOpen,
      onConnected,
    },
  };
}

export type ModelSetupProps = {
  onConnected: () => void;
  onLater: () => void;
};

export function useModelSetup({ onConnected, onLater }: ModelSetupProps): {
  view: ModelSetupViewProps;
  providerDialog: AddProviderDialogProps;
} {
  const { providers, providerDialog } = useProviderTiles(() => {
    clearModelSetupDeferral();
    onConnected();
  });
  return {
    view: {
      providers,
      onLater: () => {
        try {
          sessionStorage.setItem(MODEL_SETUP_LATER_KEY, "1");
        } catch (error) {
          // Continuing still leaves this screen for the rest of the mount.
          console.warn(
            "Browser storage refused the deferral; model setup asks again next visit.",
            error,
          );
        }
        onLater();
      },
    },
    providerDialog,
  };
}

export type EnableAiDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/**
 * A connection refreshes the shared model catalog, which is what the project watches to start its
 * coordinator.
 */
export function useEnableAiDialog({
  open,
  onOpenChange,
}: EnableAiDialogProps): {
  view: EnableAiDialogViewProps;
  providerDialog: AddProviderDialogProps;
} {
  const { providers, providerDialog } = useProviderTiles(() => {
    clearModelSetupDeferral();
    onOpenChange(false);
  });
  return { view: { open, onOpenChange, providers }, providerDialog };
}
