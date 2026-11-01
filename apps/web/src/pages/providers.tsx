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
import { wording } from "../config.ts";
import { EmptyState, Input, Section } from "@corbits/react-ui";
import { DialogFieldLabel } from "@corbits/react-ui/ui/dialog";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import type {
  ModelProvider,
  ProviderStatus,
} from "@corbits-builder/schemas/models";
import type { ModelLoginPlugin } from "@corbits-builder/client";
import { Banner, Button, QuietState } from "../components.jsx";
import { keys } from "../queries/keys.ts";
import { productClient } from "../api/transport.ts";
import { workspaceTenantId } from "../api/auth.ts";
import { setCredential } from "../api/credentials.ts";
import {
  CustomProviderRow,
  ProviderDialog,
  ProviderPicker,
  message,
  useCustomProviderForm,
} from "./custom-providers.tsx";

const copy = wording.providers;

// The picker's tile for a person's own endpoint; no catalog provider has this id.
const CUSTOM_ENDPOINT = "custom-endpoint";

const POLL_MS = 1000;
// The hub's login holds the provider's loopback port for five minutes.
const LOGIN_DEADLINE_MS = 5 * 60 * 1000;

const STATUS_TONE = {
  connected: "success",
  refused: "error",
  unavailable: "warning",
  unconfigured: "warning",
} as const satisfies Record<ProviderStatus, string>;

export function useModelCatalog() {
  return useQuery({
    queryKey: keys.modelCatalog,
    queryFn: async () =>
      productClient().modelCatalog(await workspaceTenantId()),
  });
}

/** Runs one subscription login through the hub and points the catalog at its credential. */
async function logIn(provider: ModelProvider) {
  const tenantId = await workspaceTenantId();
  const client = productClient();
  const plugin = provider.plugin as ModelLoginPlugin;
  const connection = copy.loginConnection(provider.label);
  const login = await client.startModelLogin(tenantId, plugin, connection);
  window.open(login.authorizeUrl, "_blank", "noopener");
  const deadline = Date.now() + LOGIN_DEADLINE_MS;
  for (;;) {
    if (Date.now() > deadline) throw new Error(copy.timedOut);
    const state = await client.modelLogin(tenantId, login.loginId);
    if (state.status === "failed") throw new Error(state.message);
    if (state.status === "completed") {
      await client.finishModelLogin(
        tenantId,
        plugin,
        state.credentialId,
        connection,
      );
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

/** The subscription logins in the catalog, and one at a time signing in through the hub. */
export function useSubscriptionLogins(onConnected: () => void) {
  const catalog = useModelCatalog();
  const queryClient = useQueryClient();
  const [signingIn, setSigningIn] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const logins = (catalog.data?.providers ?? []).filter(
    (provider) => provider.kind === "login",
  );

  const signIn = async (provider: ModelProvider) => {
    setSigningIn(provider.id);
    setError(null);
    try {
      await logIn(provider);
      await queryClient.invalidateQueries({ queryKey: keys.modelCatalog });
      onConnected();
    } catch (cause) {
      setError(message(cause));
    } finally {
      setSigningIn(null);
    }
  };

  return { logins, signingIn, error, signIn };
}

/** One row per subscription login, each running the real sign-in through the hub. */
export function SubscriptionLogins({
  onConnected,
}: {
  onConnected: () => void;
}) {
  const { logins, signingIn, error, signIn } =
    useSubscriptionLogins(onConnected);

  return (
    <>
      {error ? <Banner tone="error" title={error} /> : null}
      {logins.map((provider) => {
        const live = provider.connections.find(
          (connection) => connection.status === "connected",
        );
        return (
          <div key={provider.id} className="row">
            <div className="k">
              <b>{copy.login(provider.label)}</b>
              <span>{live ? copy.status.connected : copy.notConnected}</span>
            </div>
            <Button
              loading={signingIn === provider.id}
              disabled={signingIn !== null}
              onClick={() => void signIn(provider)}
            >
              {signingIn === provider.id
                ? copy.waiting
                : live
                  ? copy.signInAgain
                  : copy.signIn}
            </Button>
          </div>
        );
      })}
    </>
  );
}

/** The subscription logins first, then the API-key providers with what their last check found. */
export function ProvidersSection({ onChanged }: { onChanged: () => void }) {
  const catalog = useModelCatalog();
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const providers = catalog.data?.providers ?? [];
  const hasLogins = providers.some((provider) => provider.kind === "login");
  const connected = providers
    .filter((provider) => provider.kind !== "login")
    .flatMap((provider) =>
      provider.connections.map((connection) => ({ provider, connection })),
    );

  const apiKeys = (
    <>
      {catalog.isSuccess && connected.length === 0 ? (
        <EmptyState
          title={copy.none}
          description={copy.noneHint}
          action={
            <Button variant="primary" onClick={() => setAdding(true)}>
              {copy.connect}
            </Button>
          }
        />
      ) : null}
      {connected.map(({ provider, connection }) =>
        provider.kind === "custom" ? (
          <CustomProviderRow
            key={connection.id}
            provider={provider}
            apis={catalog.data?.customApis ?? []}
            onChanged={onChanged}
            onError={setError}
          />
        ) : (
          <div key={connection.id} className="row">
            <div className="k">
              <b>{connection.name}</b>
              {connection.name === provider.label ? null : (
                <span>{provider.label}</span>
              )}
              {connection.note ? <span>{connection.note}</span> : null}
            </div>
            {connection.status ? (
              <QuietState tone={STATUS_TONE[connection.status]}>
                {copy.status[connection.status]}
              </QuietState>
            ) : null}
          </div>
        ),
      )}
      {error ? <Banner tone="error" title={error} /> : null}
    </>
  );
  const addAction =
    connected.length > 0 ? (
      <Button onClick={() => setAdding(true)}>{copy.add}</Button>
    ) : undefined;

  return (
    <Section
      title={copy.section}
      description={copy.lead}
      action={hasLogins ? undefined : addAction}
    >
      <div className="section-body">
        {catalog.error ? (
          <Banner tone="error" title={message(catalog.error)} />
        ) : null}
        <SubscriptionLogins onConnected={onChanged} />
        {hasLogins ? (
          <Section as="h3" title={copy.apiKeyGroup} action={addAction}>
            {apiKeys}
          </Section>
        ) : (
          apiKeys
        )}
      </div>
      <AddProviderDialog
        open={adding}
        onOpenChange={setAdding}
        onConnected={onChanged}
      />
    </Section>
  );
}

/** The one call to action when nothing is connected: it opens the same dialog Settings uses. */
export function ConnectProvider({
  onConnected,
  block = false,
}: {
  onConnected: () => void;
  block?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="primary" block={block} onClick={() => setOpen(true)}>
        {copy.connect}
      </Button>
      <AddProviderDialog
        open={open}
        onOpenChange={setOpen}
        onConnected={onConnected}
      />
    </>
  );
}

export function AddProviderDialog({
  open,
  onOpenChange,
  onConnected,
  providerId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConnected: () => void;
  providerId?: string | undefined;
}) {
  const catalog = useModelCatalog();
  const queryClient = useQueryClient();
  const providers = (catalog.data?.providers ?? []).filter(
    (provider) => provider.kind === "api_key",
  );
  const apis = catalog.data?.customApis ?? [];
  const [chosenId, setChosenId] = useState<string | null>(null);
  const [secret, setSecret] = useState("");
  const customForm = useCustomProviderForm(apis);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const custom = providerId === undefined && chosenId === CUSTOM_ENDPOINT;
  const chosen: ModelProvider | undefined =
    providers.find((provider) => provider.id === (providerId ?? chosenId)) ??
    providers[0];
  const keyReady = chosen !== undefined && secret.trim().length > 0;
  const ready = custom ? customForm.ready : keyReady;
  const picker = [
    ...providers,
    ...(providerId === undefined && apis.length > 0
      ? [
          {
            id: CUSTOM_ENDPOINT,
            label: copy.custom.tile,
            hint: copy.custom.tileHint,
          },
        ]
      : []),
  ];

  const close = (next: boolean) => {
    if (busy) return;
    if (!next) {
      setSecret("");
      customForm.reset();
      setError(null);
    }
    onOpenChange(next);
  };

  const saved = async (label: string) => {
    setSecret("");
    customForm.reset();
    toast.success(copy.saved(label));
    await queryClient.invalidateQueries({ queryKey: keys.modelCatalog });
    onConnected();
    onOpenChange(false);
  };

  const testAndSave = async () => {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (custom) {
        await customForm.save();
        await saved(customForm.name);
        return;
      }
      if (!keyReady) return;
      const tenantId = await workspaceTenantId();
      const { status } = await productClient().testProvider(tenantId, {
        plugin: chosen.plugin,
        baseURL: chosen.baseURL,
        secret: secret.trim(),
      });
      if (status !== "connected") {
        setError(copy.failed[status]);
        return;
      }
      await setCredential({
        plugin: chosen.plugin,
        secret: secret.trim(),
        baseURL: chosen.baseURL,
        label: chosen.label,
      });
      await saved(chosen.label);
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ProviderDialog
      open={open}
      onOpenChange={close}
      title={
        custom
          ? copy.custom.addTitle
          : providerId && chosen
            ? copy.connectOne(chosen.label)
            : copy.dialogTitle
      }
      description={
        custom
          ? copy.custom.addLead
          : providerId
            ? copy.keyLead
            : copy.dialogLead
      }
      error={error}
      busy={busy}
      ready={ready}
      tests
      onSubmit={() => void testAndSave()}
      onBack={
        custom
          ? () => {
              setChosenId(null);
              setError(null);
            }
          : undefined
      }
      rows={custom}
    >
      {catalog.error ? (
        <Banner tone="error" title={message(catalog.error)} />
      ) : null}
      {providerId || custom ? null : (
        <div className="provider-field">
          <DialogFieldLabel id="provider-choice-label">
            {copy.provider}
          </DialogFieldLabel>
          <ProviderPicker
            providers={picker}
            chosenId={chosen?.id}
            disabled={busy}
            labelledBy="provider-choice-label"
            onChoose={(id) => {
              setChosenId(id);
              setError(null);
            }}
          />
        </div>
      )}
      {custom ? (
        customForm.rows(busy)
      ) : (
        <div className="provider-field">
          <DialogFieldLabel htmlFor="provider-key">{copy.key}</DialogFieldLabel>
          <Input
            id="provider-key"
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={secret}
            disabled={busy}
            onChange={(event) => setSecret(event.target.value)}
          />
        </div>
      )}
    </ProviderDialog>
  );
}
