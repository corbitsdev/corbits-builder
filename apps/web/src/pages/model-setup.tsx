/**
 * The screen before the project list, when no model credential reaches this
 * workspace (its own or the server's): a tile per subscription login, then a
 * tile per API-key provider opening the Add provider dialog Settings uses.
 */
import { useState } from "react";
import { productName, wording } from "../config.ts";
import { AuthLayout, DitherCanvas, KindCardGrid } from "@corbits/react-ui";
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
  const catalog = useModelCatalog();
  const { logins, signingIn, error, signIn } = useSubscriptionLogins(connected);
  const apiKeyProviders = (catalog.data?.providers ?? []).filter(
    (provider) => provider.kind === "api_key",
  );
  const [keyOpen, setKeyOpen] = useState(false);
  const [keyProviderId, setKeyProviderId] = useState<string>();
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
        {catalog.error ? (
          <Banner tone="error" title={catalog.error.message} />
        ) : null}
        {error ? <Banner tone="error" title={error} /> : null}
        <KindCardGrid
          label={copy.loginGroup}
          className="provider-tiles"
          options={logins.map((provider) => ({
            id: provider.id,
            title: provider.label,
            description:
              signingIn === provider.id ? copy.waiting : provider.hint,
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
          onConnected={connected}
        />
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
