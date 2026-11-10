/**
 * The workspace's model catalog as the hub gives it (`/settings/models`), and the subscription
 * sign-in that adds a connection to it: the hub runs the sign-in, this opens its authorize URL
 * and waits for the hub to finish.
 */
import { QueryObserver, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import {
  ModelLoginPlugin,
  type ModelProvider,
} from "@corbits-builder/schemas/models";
import { type } from "arktype";
import { wording } from "../../config.ts";
import { queryClient } from "../../queries/client.ts";
import { keys } from "../../queries/keys.ts";
import { productClient } from "../../api/transport.ts";
import { workspaceTenantId } from "../../api/auth.ts";

const copy = wording.providers;

/** The catalog's providers until it has been read. */
export const NO_PROVIDERS: readonly ModelProvider[] = [];

const POLL_MS = 1000;
// The hub's login holds the provider's loopback port for five minutes.
const LOGIN_DEADLINE_MS = 5 * 60 * 1000;

export function message(cause: unknown): string {
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
  const plugin = ModelLoginPlugin(provider.plugin);
  if (plugin instanceof type.errors)
    throw new Error(copy.loginUnsupported(provider.label));
  const connection = copy.loginConnection(provider.label);
  const login = await client.startModelLogin(tenantId, plugin, connection);
  window.open(login.authorizeUrl, "_blank", "noopener");
  const credentialId = await loginCredential(
    tenantId,
    login.loginId,
    Date.now() + LOGIN_DEADLINE_MS,
  );
  await client.finishModelLogin(tenantId, plugin, credentialId, connection);
}

/**
 * The credential a hub login ends with, polled until it ends. The person signs
 * in on the provider's tab, so the poll runs while this one is in the
 * background, and the deadline holds even while the browser says it is offline.
 */
export function loginCredential(
  tenantId: string,
  loginId: string,
  deadline: number,
): Promise<string> {
  const observer = new QueryObserver(queryClient, {
    queryKey: keys.modelLogin(loginId),
    queryFn: async ({ signal }) => {
      if (Date.now() > deadline) throw new Error(copy.timedOut);
      return productClient().modelLogin(tenantId, loginId, signal);
    },
    refetchInterval: POLL_MS,
    refetchIntervalInBackground: true,
    networkMode: "always",
    retry: false,
    gcTime: 0,
    meta: { persist: false },
  });
  return new Promise((resolve, reject) => {
    const stop = observer.subscribe((result) => {
      const state = result.data;
      if (result.isError) reject(result.error);
      else if (state?.status === "failed") reject(new Error(state.message));
      else if (state?.status === "completed") resolve(state.credentialId);
      else return;
      stop();
    });
  });
}

/** The subscription logins in the catalog, and one at a time signing in through the hub. */
export function useSubscriptionLogins(onConnected: () => void) {
  const catalog = useModelCatalog();
  const queryClient = useQueryClient();
  const [signingIn, setSigningIn] = useState<string | null>(null);
  const logins = (catalog.data?.providers ?? NO_PROVIDERS).filter(
    (provider) => provider.kind === "login",
  );

  const signIn = async (id: string) => {
    setSigningIn(id);
    try {
      await logIn(logins.find((login) => login.id === id)!);
      await queryClient.invalidateQueries({ queryKey: keys.modelCatalog });
      onConnected();
    } catch (cause) {
      toast.error(message(cause));
    } finally {
      setSigningIn(null);
    }
  };

  return { logins, signingIn, signIn };
}
