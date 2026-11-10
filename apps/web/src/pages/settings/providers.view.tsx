/**
 * The Providers section as it looks: the subscription logins first, then the providers connected
 * by a key with what their last check found, and the one way to add another. Nothing here shows a
 * key or token.
 */
import { Fragment, type ReactNode } from "react";
import { EmptyState, Section } from "@corbits/react-ui";
import { wording } from "../../config.ts";
import { Banner, Button, QuietState } from "../../components.jsx";
import { SettingsRow } from "./settings-row.tsx";
import { SettingsSectionBody } from "./settings-section.tsx";

const copy = wording.providers;

/** What the last check of a connection's key found. */
export type KeyCheck = "connected" | "refused" | "unavailable" | "unconfigured";

const STATUS_TONE = {
  connected: "success",
  refused: "error",
  unavailable: "warning",
  unconfigured: "warning",
} as const satisfies Record<KeyCheck, string>;

/** A provider a person signs in to instead of pasting a key. */
export type SubscriptionLogin = {
  id: string;
  /** The provider's name. */
  name: string;
  /** A sign-in to it is live, so its button offers to log in again. */
  connected: boolean;
};

/** A provider connected by a key. */
export type KeyConnection = {
  id: string;
  name: string;
  /** Its provider's name, when the connection goes by another. */
  provider: string | null;
  /** Where it comes from when the person did not make it, such as the server's keys. */
  source: string | null;
  /** Null when its key was not checked. */
  status: KeyCheck | null;
};

export type ProvidersSectionViewProps = {
  /** The providers are still being read. */
  loading: boolean;
  /** Why they could not be read; what an earlier read found stays under it. */
  fault: string | null;
  /** The subscription logins, a row each above the key providers. */
  logins: readonly SubscriptionLogin[];
  /** The login whose sign-in is under way in the provider's tab; every button waits for it. */
  signingIn: string | null;
  onSignIn: (id: string) => void;
  /** The providers connected by a key, a row each; a custom endpoint's row is the page's to fill. */
  connections: readonly (KeyConnection | { id: string; endpoint: ReactNode })[];
  onAdd: () => void;
  /** The Add provider dialog. */
  addDialog: ReactNode;
};

export function ProvidersSectionView({
  loading,
  fault,
  logins,
  signingIn,
  onSignIn,
  connections,
  onAdd,
  addDialog,
}: ProvidersSectionViewProps) {
  const hasLogins = logins.length > 0;
  const apiKeys = (
    <>
      {!loading && fault === null && connections.length === 0 ? (
        <EmptyState
          title={copy.none}
          description={copy.noneHint}
          action={
            <Button variant="primary" onClick={onAdd}>
              {copy.connect}
            </Button>
          }
        />
      ) : null}
      {connections.map((connection) =>
        "endpoint" in connection ? (
          <Fragment key={connection.id}>{connection.endpoint}</Fragment>
        ) : (
          <SettingsRow
            key={connection.id}
            label={connection.name}
            hint={[connection.provider, connection.source]}
          >
            {connection.status ? (
              <QuietState tone={STATUS_TONE[connection.status]}>
                {copy.status[connection.status]}
              </QuietState>
            ) : null}
          </SettingsRow>
        ),
      )}
    </>
  );
  const addAction =
    connections.length > 0 ? (
      <Button onClick={onAdd}>{copy.add}</Button>
    ) : undefined;

  return (
    <Section
      title={copy.section}
      description={copy.lead}
      action={hasLogins ? undefined : addAction}
    >
      <SettingsSectionBody>
        {fault === null ? null : <Banner tone="error" title={fault} />}
        <SubscriptionLogins
          logins={logins}
          signingIn={signingIn}
          onSignIn={onSignIn}
        />
        {hasLogins ? (
          <Section as="h3" title={copy.apiKeyGroup} action={addAction}>
            {apiKeys}
          </Section>
        ) : (
          apiKeys
        )}
      </SettingsSectionBody>
      {addDialog}
    </Section>
  );
}

function signInLabel(login: SubscriptionLogin, signingIn: string | null) {
  if (signingIn === login.id) return copy.waiting;
  return login.connected ? copy.signInAgain : copy.signIn;
}

/** One row per subscription login, saying whether it is connected, with the button that signs in. */
function SubscriptionLogins({
  logins,
  signingIn,
  onSignIn,
}: Pick<ProvidersSectionViewProps, "logins" | "signingIn" | "onSignIn">) {
  return (
    <>
      {logins.map((login) => (
        <SettingsRow
          key={login.id}
          label={copy.login(login.name)}
          hint={login.connected ? copy.status.connected : copy.notConnected}
        >
          <Button
            loading={signingIn === login.id}
            disabled={signingIn !== null}
            onClick={() => onSignIn(login.id)}
          >
            {signInLabel(login, signingIn)}
          </Button>
        </SettingsRow>
      ))}
    </>
  );
}
