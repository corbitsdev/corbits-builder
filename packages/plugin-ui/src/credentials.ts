/**
 * Calls Interchange's provider and credential routes with the person's session. Nothing here
 * returns or logs a secret: a key goes in, and the rows that come back contain no secret.
 */
import { type } from "arktype";
import {
  credentialProvider,
  type HttpCredentialDeclaration,
} from "@corbits-builder/plugin";
import {
  CredentialResponse,
  ErrorResponse,
  ProviderResponse,
  paginatedSchema,
} from "@intx/types";
import { serverLabel } from "@corbits-builder/plugin/server-address";

const Providers = paginatedSchema(ProviderResponse);
const Credentials = paginatedSchema(CredentialResponse);

// The hub's routes put the refusal code at the top level of the body.
const HubRefusal = type({ code: "string", "+": "ignore" });

/** Turns a refusal from Interchange or the hub into an error whose message is only its code. */
export async function refusal(response: Response): Promise<Error> {
  const code = String(response.status);
  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    // A proxy's error page is not JSON, so the status is the only code there is.
    if (!(error instanceof SyntaxError)) throw error;
    return new Error(code);
  }
  if (ErrorResponse.allows(body)) return new Error(body.error.code);
  if (HubRefusal.allows(body)) return new Error(body.code);
  return new Error(code);
}

/** Calls an Interchange or hub tenant route and returns the response unchanged. */
export async function send(
  path: string,
  method: "GET" | "POST" | "PATCH" | "DELETE",
  body: object | undefined,
): Promise<Response> {
  const init: RequestInit = { method, credentials: "same-origin" };
  if (body !== undefined) {
    init.headers = { "content-type": "application/json" };
    init.body = JSON.stringify(body);
  }
  return fetch(`/api/tenants/${path}`, init);
}

/** Calls an Interchange or hub tenant route and returns the JSON body, or throws the refusal. */
export async function json(
  path: string,
  method: "GET" | "POST" | "PATCH",
  body: object | undefined,
): Promise<unknown> {
  const response = await send(path, method, body);
  if (!response.ok) throw await refusal(response);
  return response.json();
}

function secretOf(
  sends: HttpCredentialDeclaration["sends"],
  key: string,
): string {
  if (sends === "bearer") return key;
  const material: { header: string; prefix?: string; value: string } = {
    header: sends.header,
    value: key,
  };
  if (sends.prefix !== undefined) material.prefix = sends.prefix;
  return JSON.stringify(material);
}

const credentialPath = (tenant: string, id: string) =>
  `${encodeURIComponent(tenant)}/credentials/${encodeURIComponent(id)}`;

/** Every credential the tenant has itself, read page by page, without secrets. */
export async function heldCredentials(tenant: string) {
  const path = `${encodeURIComponent(tenant)}/credentials`;
  let page = Credentials.assert(await json(path, "GET", undefined));
  const held = page.data;
  while (page.nextCursor !== null) {
    page = Credentials.assert(
      await json(
        `${path}?cursor=${encodeURIComponent(page.nextCursor)}`,
        "GET",
        undefined,
      ),
    );
    held.push(...page.data);
  }
  return held;
}

const providerPath = (tenant: string, id: string) =>
  `${encodeURIComponent(tenant)}/providers/${encodeURIComponent(id)}`;

// The Interchange plugin that sends a server key.
const SSH_PLUGIN = "ssh";

// The providers the tenant has itself, not inherited ones, read page by page.
async function ownProviders(tenant: string) {
  const path = `${encodeURIComponent(tenant)}/providers?inherited=false`;
  const rows: (typeof ProviderResponse.infer)[] = [];
  let cursor: string | null = null;
  do {
    const page = Providers.assert(
      await json(
        cursor === null ? path : `${path}&cursor=${encodeURIComponent(cursor)}`,
        "GET",
        undefined,
      ),
    );
    rows.push(...page.data);
    cursor = page.nextCursor;
  } while (cursor !== null);
  return rows;
}

/** The servers the tenant has keys for: each server's address, keyed by the id of the provider its
 * key is pinned to. No secrets. */
export async function heldServers(
  tenant: string,
): Promise<Record<string, string>> {
  const servers: Record<string, string> = {};
  for (const row of await ownProviders(tenant))
    if (row.plugin === SSH_PLUGIN && row.apiBaseUrl)
      servers[row.id] = serverLabel(row.apiBaseUrl);
  return servers;
}

/** Deletes one of the tenant's credentials. For a server key it also deletes the tenant's provider
 * row for that server, so the old address does not shadow a key saved for the next server. */
export async function revokeCredential(
  tenant: string,
  id: string,
): Promise<void> {
  const { providerId } = CredentialResponse.assert(
    await json(credentialPath(tenant, id), "GET", undefined),
  );
  const revoked = await send(credentialPath(tenant, id), "DELETE", undefined);
  if (!revoked.ok) throw await refusal(revoked);
  const provider = ProviderResponse.assert(
    await json(providerPath(tenant, providerId), "GET", undefined),
  );
  if (provider.plugin !== SSH_PLUGIN || provider.tenantId !== tenant) return;
  const removed = await send(
    providerPath(tenant, providerId),
    "DELETE",
    undefined,
  );
  if (!removed.ok) throw await refusal(removed);
}

// How Interchange sends a credential: the plugin and the address it is pinned to.
type ProviderShape = { plugin: string; apiBaseUrl: string };

// Creates the credential's provider in `tenant`, or updates it to match `shape`, and returns its
// id.
async function syncProvider(
  tenant: string,
  name: string,
  shape: ProviderShape,
): Promise<string> {
  // The provider and the credential share a name.
  const provider = credentialProvider(name);
  const providers = `${encodeURIComponent(tenant)}/providers`;
  // The inherited listing is not paged. A provider with this name in this tenant shadows any above
  // it.
  const listed = Providers.assert(await json(providers, "GET", undefined));
  const existing = listed.data.find(
    (row) => row.name === provider && row.tenantId === tenant,
  );
  if (!existing)
    return ProviderResponse.assert(
      await json(providers, "POST", { name: provider, ...shape }),
    ).id;
  if (
    existing.plugin !== shape.plugin ||
    existing.apiBaseUrl !== shape.apiBaseUrl
  )
    await json(providerPath(tenant, existing.id), "PATCH", shape);
  return existing.id;
}

/** Where an API key is sent, and how, as its plugin declares it. */
export type ApiKeySending = Pick<HttpCredentialDeclaration, "origin" | "sends">;

const apiKeyProvider = ({ origin, sends }: ApiKeySending): ProviderShape => ({
  plugin: sends === "bearer" ? "http" : "http-header",
  apiBaseUrl: origin,
});

async function rotate(owner: string, id: string, secret: string) {
  await json(credentialPath(owner, id), "PATCH", { secret, status: "active" });
}

/** The credential `owner` itself has under `name`. Undefined when it has none, even if a tenant
 * above it does. */
export async function ownCredential(owner: string, name: string) {
  const resolved = await send(
    `${encodeURIComponent(owner)}/credentials/resolve/${encodeURIComponent(credentialProvider(name))}`,
    "GET",
    undefined,
  );
  if (resolved.status === 404) return undefined;
  if (!resolved.ok) throw await refusal(resolved);
  const held = CredentialResponse.assert(await resolved.json());
  // Resolution walks up the tenants.
  return held.tenantId === owner ? held : undefined;
}

// Puts `secret` in `owner`'s own credential `name`, or creates that credential under the provider
// `providerId`.
async function holdCredential(
  owner: string,
  providerId: string,
  name: string,
  secret: string,
): Promise<void> {
  const held = await ownCredential(owner, name);
  if (held !== undefined) {
    await rotate(owner, held.id, secret);
    return;
  }
  await json(`${encodeURIComponent(owner)}/credentials`, "POST", {
    providerId,
    name: credentialProvider(name),
    type: "api_key",
    secret,
  });
}

/** Puts a new key in the owner tenant's credential `id`, sent the way its plugin declares. */
export async function replaceCredential(
  tenants: { owner: string; workspace: string },
  id: string,
  name: string,
  sending: ApiKeySending,
  key: string,
): Promise<void> {
  await syncProvider(tenants.workspace, name, apiKeyProvider(sending));
  await rotate(tenants.owner, id, secretOf(sending.sends, key));
}

/** Saves an API key in `tenants.owner`, the project or the workspace, under the workspace's
 * provider for it. */
export async function saveApiKey(
  tenants: { owner: string; workspace: string },
  name: string,
  sending: ApiKeySending,
  key: string,
): Promise<void> {
  const id = await syncProvider(
    tenants.workspace,
    name,
    apiKeyProvider(sending),
  );
  await holdCredential(tenants.owner, id, name, secretOf(sending.sends, key));
}
