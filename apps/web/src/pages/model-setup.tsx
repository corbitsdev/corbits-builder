/**
 * The screen before the project list, when no model credential reaches this
 * workspace (its own or the server's): a tile per subscription login, then a
 * tile per API-key provider opening the Add provider dialog Settings uses.
 */
import { useState } from "react";
import { productName, wording } from "../config.ts";
import { AuthLayout, DitherCanvas, KindCardGrid } from "@corbits/react-ui";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@corbits/react-ui/ui/dialog";
import { Banner, Mark, QUIET_CONTROL } from "../components.jsx";
import {
  AddProviderDialog,
  useModelCatalog,
  useSubscriptionLogins,
} from "./providers.jsx";
import { ProviderLogo } from "./provider-logos.tsx";

const copy = wording.providers;

export const MODEL_SETUP_LATER_KEY = "sb.model-setup.later";

export function modelSetupDeferred(): boolean {
  try {
    return sessionStorage.getItem(MODEL_SETUP_LATER_KEY) === "1";
  } catch {
    return false;
  }
}

/** Asks again: a newly opened workspace has its own keys to connect. */
export function clearModelSetupDeferral(): void {
  try {
    sessionStorage.removeItem(MODEL_SETUP_LATER_KEY);
  } catch {
    // Unavailable storage never held the deferral either.
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

/**
 * A tile per subscription login, then a tile per API-key provider opening the Add provider dialog.
 * The caller holds the logins, so a sign-in in flight outlives the tiles when a dialog closes.
 */
function ProviderTiles({
  subscriptions,
  onConnected,
}: {
  subscriptions: ReturnType<typeof useSubscriptionLogins>;
  onConnected: () => void;
}) {
  const catalog = useModelCatalog();
  const { logins, signingIn, signIn } = subscriptions;
  const [keyOpen, setKeyOpen] = useState(false);
  const [keyProviderId, setKeyProviderId] = useState<string>();
  const fault = catalog.error ? (
    <Banner tone="error" title={catalog.error.message} />
  ) : null;
  // No tiles until the catalog says which providers exist; a failed refetch keeps the last read.
  if (catalog.data === undefined) return fault;
  const apiKeyProviders = catalog.data.providers.filter(
    (provider) => provider.kind === "api_key",
  );
  return (
    <>
      {fault}
      <KindCardGrid
        label={copy.loginGroup}
        className="provider-tiles"
        options={logins.map((provider) => ({
          id: provider.id,
          title: provider.label,
          description: signingIn === provider.id ? copy.waiting : provider.hint,
          icon: <ProviderLogo providerId={provider.id} />,
          disabled: signingIn !== null,
        }))}
        onChange={(id) => {
          const provider = logins.find((login) => login.id === id);
          if (provider) void signIn(provider);
        }}
      />
      <hr className="model-setup-divider" />
      <KindCardGrid
        label={copy.apiKeyGroup}
        className="provider-tiles"
        options={apiKeyProviders.map((provider) => ({
          id: provider.id,
          title: provider.label,
          description: provider.hint,
          icon: <ProviderLogo providerId={provider.id} />,
          disabled: signingIn !== null,
        }))}
        onChange={(id) => {
          setKeyProviderId(id);
          setKeyOpen(true);
        }}
      />
      <AddProviderDialog
        key={keyProviderId}
        providerId={keyProviderId}
        open={keyOpen}
        onOpenChange={setKeyOpen}
        onConnected={onConnected}
      />
    </>
  );
}

export function ModelSetup({
  onConnected,
  onLater,
}: {
  onConnected: () => void;
  onLater: () => void;
}) {
  const connected = () => {
    clearModelSetupDeferral();
    onConnected();
  };
  const subscriptions = useSubscriptionLogins(connected);
  return (
    <AuthLayout
      brand={
        <>
          <Mark size={22} />
          <span>{productName}</span>
        </>
      }
      panel={<DitherCanvas />}
    >
      <div className="model-setup">
        <hgroup>
          <h1>{copy.connect}</h1>
          <p>{copy.noneHint}</p>
        </hgroup>
        <ProviderTiles subscriptions={subscriptions} onConnected={connected} />
        <div className="model-setup-later">
          <button
            type="button"
            className={QUIET_CONTROL}
            onClick={() => {
              try {
                sessionStorage.setItem(MODEL_SETUP_LATER_KEY, "1");
              } catch {
                // Continuing still leaves this screen for the rest of the mount.
              }
              onLater();
            }}
          >
            {wording.action.skipForNow}
          </button>
          <p>{copy.addLater}</p>
        </div>
      </div>
    </AuthLayout>
  );
}

/**
 * The same tiles over the open project, so connecting never leaves it. A connection refreshes the
 * shared model catalog, which is what the project watches to start its coordinator.
 */
export function EnableAiDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const connected = () => {
    clearModelSetupDeferral();
    onOpenChange(false);
  };
  const subscriptions = useSubscriptionLogins(connected);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{copy.connect}</DialogTitle>
          <DialogDescription>{copy.noneHint}</DialogDescription>
        </DialogHeader>
        <DialogBody className="model-setup">
          <ProviderTiles
            subscriptions={subscriptions}
            onConnected={connected}
          />
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
