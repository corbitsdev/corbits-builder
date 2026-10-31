/**
 * Inference credentials over the hub's bring-your-own-key endpoints: the
 * connected model providers read, and one key write that composes the native
 * provider row, the encrypted credential slot and the catalog provider
 * binding. Secrets are sent once in the request body and never returned or
 * logged.
 *
 * The hub records no per-provider model lists, priorities or validated-at
 * stamps, so those `Provider` fields stay empty; identity, base URL and
 * whether a credential is set come from the catalog.
 */
import { productClient } from "./transport.ts";
import type { Provider } from "./types.ts";
import type { ModelProviderView } from "@corbits-builder/client";
import { workspaceTenantId } from "./auth.ts";

export type {
  ModelCredentialInput,
  ModelCredentialReceipt,
  ModelProviderView,
} from "@corbits-builder/client";

export async function listCredentials(): Promise<Provider[]> {
  const client = productClient();
  const tenantId = await workspaceTenantId();
  const rows = await client.modelProviders(tenantId);
  return rows.map(providerOf);
}

function providerOf(row: ModelProviderView): Provider {
  return {
    id: row.id,
    providerId: row.plugin,
    label: row.name,
    kind: "api_key",
    baseUrl: row.baseURL === "" ? null : row.baseURL,
    status: row.disabled ? "disabled" : "connected",
    statusDetail: null,
    models: [],
    active: !row.disabled,
    priority: 0,
    hasCredential: row.credentialId !== null,
    validatedAt: null,
    selectedModel: null,
    enabledModels: [],
    selectedOfferingId: null,
  };
}

/** Stores one API key behind the onboarding "connect inference" step. */
export function setCredential(input: {
  plugin: string;
  secret: string;
  baseURL?: string;
  label?: string;
}) {
  const client = productClient();
  return workspaceTenantId().then((tenantId) =>
    client.addModelCredential(tenantId, input),
  );
}
