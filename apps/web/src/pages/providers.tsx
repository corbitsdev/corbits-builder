/**
 * Model providers: the connected ones with their live status, and the one way to add another.
 *
 * Which providers exist, what they are called and what they need comes from the hub's
 * config through `/settings/models`. A subscription provider is connected by logging in: the hub
 * runs the sign-in, this page opens its authorize URL and waits for the hub to finish. Adding an
 * API-key provider is: pick it, paste its key (and base URL), test it with one real model-list
 * call, and only a key that passes is saved. Keys live in form state until they are handed over,
 * and nothing here renders a key or token back.
 */
import { wording } from "../config.ts";
import { EmptyState, Input, Section } from "@corbits/react-ui";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFieldLabel,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@corbits/react-ui/ui/dialog";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState, type KeyboardEvent } from "react";
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
import { ProviderLogo } from "./provider-logos.tsx";

const copy = wording.providers;

const POLL_MS = 1000;
// The hub's login holds the provider's loopback port for five minutes.
const LOGIN_DEADLINE_MS = 5 * 60 * 1000;

const STATUS_TONE = {
  connected: "success",
  refused: "error",
  unavailable: "warning",
  unconfigured: "warning",
} as const satisfies Record<ProviderStatus, string>;

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

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
  const providers = catalog.data?.providers ?? [];
  const hasLogins = providers.some((provider) => provider.kind === "login");
  const connected = providers
    .filter((provider) => provider.kind === "api_key")
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
      {connected.map(({ provider, connection }) => (
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
      ))}
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
  const [chosenId, setChosenId] = useState<string | null>(null);
  const [baseUrl, setBaseUrl] = useState("");
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const chosen: ModelProvider | undefined =
    providers.find((provider) => provider.id === (providerId ?? chosenId)) ??
    providers[0];
  const ready =
    chosen !== undefined &&
    secret.trim().length > 0 &&
    (!chosen.needsBaseUrl || baseUrl.trim().length > 0);

  const close = (next: boolean) => {
    if (busy) return;
    if (!next) {
      setSecret("");
      setBaseUrl("");
      setError(null);
    }
    onOpenChange(next);
  };

  const testAndSave = async () => {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      const tenantId = await workspaceTenantId();
      const endpoint = chosen.needsBaseUrl ? baseUrl.trim() : chosen.baseURL;
      const { status } = await productClient().testProvider(tenantId, {
        plugin: chosen.plugin,
        baseURL: endpoint,
        secret: secret.trim(),
      });
      if (status !== "connected") {
        setError(copy.failed[status]);
        return;
      }
      await setCredential({
        plugin: chosen.plugin,
        secret: secret.trim(),
        baseURL: endpoint,
        label: chosen.label,
      });
      setSecret("");
      setBaseUrl("");
      toast.success(copy.saved(chosen.label));
      await queryClient.invalidateQueries({ queryKey: keys.modelCatalog });
      onConnected();
      onOpenChange(false);
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {providerId && chosen
              ? copy.connectOne(chosen.label)
              : copy.dialogTitle}
          </DialogTitle>
          <DialogDescription>
            {providerId ? copy.keyLead : copy.dialogLead}
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void testAndSave();
          }}
        >
          <DialogBody className="provider-form">
            {catalog.error ? (
              <Banner tone="error" title={message(catalog.error)} />
            ) : null}
            {providerId ? null : (
              <div className="provider-field">
                <DialogFieldLabel id="provider-choice-label">
                  {copy.provider}
                </DialogFieldLabel>
                <ProviderPicker
                  providers={providers}
                  chosenId={chosen?.id}
                  disabled={busy}
                  onChoose={(id) => {
                    setChosenId(id);
                    setError(null);
                  }}
                />
              </div>
            )}
            {chosen?.needsBaseUrl ? (
              <div className="provider-field">
                <DialogFieldLabel htmlFor="provider-base-url">
                  {copy.baseUrl}
                </DialogFieldLabel>
                <Input
                  id="provider-base-url"
                  type="url"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="https://example.com/v1"
                  value={baseUrl}
                  disabled={busy}
                  onChange={(event) => setBaseUrl(event.target.value)}
                />
              </div>
            ) : null}
            <div className="provider-field">
              <DialogFieldLabel htmlFor="provider-key">
                {copy.key}
              </DialogFieldLabel>
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
            {error ? <Banner tone="error" title={error} /> : null}
          </DialogBody>
          <DialogFooter>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => close(false)}
            >
              {wording.action.cancel}
            </Button>
            <Button
              variant="primary"
              type="submit"
              loading={busy}
              disabled={!ready}
            >
              {busy ? copy.testing : copy.test}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const STEP: Partial<Record<string, number>> = {
  ArrowRight: 1,
  ArrowDown: 1,
  ArrowLeft: -1,
  ArrowUp: -1,
};

/** One card per provider, as a radio group: arrow keys move the choice, Tab leaves the group. */
function ProviderPicker({
  providers,
  chosenId,
  disabled,
  onChoose,
}: {
  providers: readonly ModelProvider[];
  chosenId: string | undefined;
  disabled: boolean;
  onChoose: (id: string) => void;
}) {
  const cards = useRef<(HTMLButtonElement | null)[]>([]);
  const move = (event: KeyboardEvent, index: number) => {
    const step = STEP[event.key];
    const target =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? providers.length - 1
          : step === undefined
            ? undefined
            : (index + step + providers.length) % providers.length;
    const provider = target === undefined ? undefined : providers[target];
    if (target === undefined || !provider) return;
    event.preventDefault();
    onChoose(provider.id);
    cards.current[target]?.focus();
  };
  return (
    <div
      role="radiogroup"
      aria-labelledby="provider-choice-label"
      className="provider-cards"
    >
      {providers.map((provider, index) => {
        const checked = provider.id === chosenId;
        return (
          <button
            key={provider.id}
            ref={(card) => {
              cards.current[index] = card;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            disabled={disabled}
            className="provider-card"
            onClick={() => onChoose(provider.id)}
            onKeyDown={(event) => move(event, index)}
          >
            <span className="provider-card-head">
              <span className="provider-card-logo">
                <ProviderLogo providerId={provider.id} />
              </span>
              <b>{provider.label}</b>
            </span>
            <span className="provider-hint">{provider.hint}</span>
          </button>
        );
      })}
    </div>
  );
}
