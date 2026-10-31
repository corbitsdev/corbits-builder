import { tenantPath, type ClientDeps, type ProductApiClient } from "./shared";

/**
 * BYOK model credentials, composed from the hub's real endpoints:
 *
 * 1. `POST /providers`         — native provider definition (the credential
 *                                 table's providerId foreign key needs a row;
 *                                 reused by deterministic name, never duplicated).
 * 2. `POST /credentials`       — the API key into the native encrypted
 *                                 credential slot (tenant-owned, so a catalog
 *                                 model provider may reference it). The hub
 *                                 encrypts it; no response ever carries it.
 * 3. `POST /catalog/providers` — the model provider that binds plugin,
 *                                 base URL and credentialId; this is the row
 *                                 the settings/providers read and the deploy
 *                                 composition both resolve.
 *
 * Secret handling: the key exists only in the request body of step 2 and in
 * the caller's transient form state. Responses are credential metadata only
 * (the native route never returns secret material) and this client never
 * logs, caches or echoes it.
 */

export type ModelProviderView = Readonly<{
  id: string;
  name: string;
  plugin: string;
  baseURL: string;
  credentialId: string | null;
  disabled: boolean;
}>;

export type ModelCredentialInput = Readonly<{
  plugin: string;
  /** Base URL for the model provider; defaults per plugin. */
  baseURL?: string;
  /** The user's API key. Sent once, encrypted server-side, never returned. */
  secret: string;
  /** Optional display label; a unique default is generated when absent. */
  label?: string;
}>;

export type ModelCredentialReceipt = Readonly<{
  provider: Readonly<{
    id: string;
    name: string;
    plugin: string;
    baseURL: string;
  }>;
  credential: Readonly<{ id: string; name: string }>;
  modelProvider: Readonly<{
    id: string;
    name: string;
    credentialId: string | null;
  }>;
}>;

/** A ChatGPT or xAI sign-in in flight. The authorize URL is opened by the person; no token reaches the client. */
export type ModelLogin = Readonly<{ loginId: string; authorizeUrl: string }>;
export type ModelLoginState = Readonly<
  | { status: "pending" }
  | { status: "completed"; credentialId: string }
  | { status: "failed"; message: string }
>;
export type ModelLoginPlugin = "codex" | "xai";

const DEFAULT_BASE_URLS: Record<string, string> = {
  openai: "https://api.openai.com/v1",
  "openai-responses": "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com/v1",
  "google-genai": "https://generativelanguage.googleapis.com/v1beta",
  "openai-compatible": "",
  // CODEX_BASE_URL and XAI_OAUTH_PROXY_BASE_URL: the only endpoints these logins' tokens work on.
  codex: "https://chatgpt.com/backend-api",
  xai: "https://cli-chat-proxy.grok.com/v1",
};

function uniqueSuffix(): string {
  return crypto.randomUUID().replaceAll("-", "").slice(0, 12);
}

function parseLoginState(raw: unknown): ModelLoginState {
  const row = (typeof raw === "object" && raw !== null ? raw : {}) as Record<
    string,
    unknown
  >;
  if (row["status"] === "completed" && typeof row["credentialId"] === "string")
    return { status: "completed", credentialId: row["credentialId"] };
  if (row["status"] === "failed")
    return {
      status: "failed",
      message:
        typeof row["message"] === "string"
          ? row["message"]
          : "The sign-in failed.",
    };
  return { status: "pending" };
}

/** A visible model-provider row, shape-checked without echoing unknown fields. */
function parseModelProvider(raw: unknown): ModelProviderView | null {
  if (typeof raw !== "object" || raw === null) return null;
  const row = raw as Record<string, unknown>;
  if (
    typeof row["id"] !== "string" ||
    typeof row["name"] !== "string" ||
    typeof row["plugin"] !== "string" ||
    typeof row["baseURL"] !== "string" ||
    typeof row["disabled"] !== "boolean"
  )
    return null;
  const credentialId = row["credentialId"];
  return {
    id: row["id"],
    name: row["name"],
    plugin: row["plugin"],
    baseURL: row["baseURL"],
    credentialId: typeof credentialId === "string" ? credentialId : null,
    disabled: row["disabled"],
  };
}

export function buildCredentialsMethods(
  deps: ClientDeps,
): Pick<
  ProductApiClient,
  | "modelProviders"
  | "addModelCredential"
  | "createTenantProvider"
  | "createTenantCredential"
  | "startModelLogin"
  | "modelLogin"
  | "finishModelLogin"
> {
  const { request } = deps;
  // Reuse one native provider row per plugin so repeated additions do not multiply provider
  // definitions; names are tenant-unique, so the deterministic name is the reuse key.
  async function ensureNativeProvider(
    tenantId: string,
    plugin: string,
    baseURL: string,
    signal?: AbortSignal,
  ): Promise<{ id: string }> {
    const root = tenantPath(tenantId);
    const listed = (await request(
      `${root}/providers?inherited=false`,
      signal,
    )) as {
      data?: { id?: unknown; name?: unknown }[];
    };
    const wanted = `byok-${plugin}`;
    const existing = (Array.isArray(listed?.data) ? listed.data : []).find(
      (candidate) => candidate?.name === wanted,
    );
    if (existing && typeof existing.id === "string") return { id: existing.id };
    return (await request(`${root}/providers`, signal, {
      name: wanted,
      plugin,
      ...(baseURL === "" ? {} : { apiBaseUrl: baseURL }),
    })) as { id: string };
  }
  async function modelProviders(tenantId: string, signal?: AbortSignal) {
    const raw = (await request(
      `${tenantPath(tenantId)}/catalog/providers`,
      signal,
    )) as {
      data?: unknown;
    };
    const rows = Array.isArray(raw?.data) ? raw.data : [];
    return rows
      .map(parseModelProvider)
      .filter((row): row is ModelProviderView => row !== null);
  }
  return {
    // Direct native provider/credential creates for compositions (deploy
    // coordinator) that must name rows deterministically instead of reusing
    // the byok rows. Responses are metadata only; secrets are never returned.
    async createTenantProvider(tenantId, input, signal) {
      const row = (await request(
        `${tenantPath(tenantId)}/providers`,
        signal,
        input,
      )) as {
        id?: unknown;
      };
      if (typeof row?.["id"] !== "string")
        throw new Error("invalid_native_provider_response");
      return { id: row["id"] };
    },
    async createTenantCredential(tenantId, input, signal) {
      const row = (await request(
        `${tenantPath(tenantId)}/credentials`,
        signal,
        input,
      )) as {
        id?: unknown;
      };
      if (typeof row?.["id"] !== "string")
        throw new Error("invalid_native_credential_response");
      return { id: row["id"] };
    },
    modelProviders,
    // Login with ChatGPT / xAI: the hub runs the PKCE login and stores the tokens as a
    // tenant-owned credential. A new credential name per sign-in, because a tenant-owned login
    // never replaces an existing credential.
    async startModelLogin(tenantId, plugin, name, signal) {
      const baseURL = DEFAULT_BASE_URLS[plugin]!;
      const nativeProvider = await ensureNativeProvider(
        tenantId,
        plugin,
        baseURL,
        signal,
      );
      const started = (await request(
        `${tenantPath(tenantId)}/oauth-logins`,
        signal,
        {
          provider: plugin,
          providerId: nativeProvider.id,
          credentialName: `${name} ${uniqueSuffix()}`,
        },
      )) as { loginId?: unknown; authorizeUrl?: unknown };
      if (
        typeof started?.loginId !== "string" ||
        typeof started.authorizeUrl !== "string"
      )
        throw new Error("invalid_model_login_response");
      return { loginId: started.loginId, authorizeUrl: started.authorizeUrl };
    },
    async modelLogin(tenantId, loginId, signal) {
      return parseLoginState(
        await request(
          `${tenantPath(tenantId)}/oauth-logins/${encodeURIComponent(loginId)}`,
          signal,
        ),
      );
    },
    // Points the catalog at the new login: the plugin's earlier model providers are disabled so
    // deploys resolve the one this login backs.
    async finishModelLogin(tenantId, plugin, credentialId, name, signal) {
      const root = tenantPath(tenantId);
      for (const row of await modelProviders(tenantId, signal))
        if (row.plugin === plugin && !row.disabled)
          await request(
            `${root}/catalog/providers/${encodeURIComponent(row.id)}`,
            signal,
            { disabled: true },
            "PATCH",
          );
      const created = (await request(`${root}/catalog/providers`, signal, {
        name: `${name} ${uniqueSuffix()}`,
        plugin,
        baseURL: DEFAULT_BASE_URLS[plugin],
        credentialId,
      })) as { id?: unknown };
      if (typeof created?.id !== "string")
        throw new Error("invalid_model_provider_response");
      return { id: created.id };
    },
    async addModelCredential(tenantId, input, signal) {
      const root = tenantPath(tenantId);
      const unique = uniqueSuffix();
      const label = input.label?.trim() || "Model credential";
      const baseURL = input.baseURL?.trim() || DEFAULT_BASE_URLS[input.plugin];
      if (!baseURL)
        throw new Error(
          `A base URL is required for the ${input.plugin} provider.`,
        );

      const nativeProvider = await ensureNativeProvider(
        tenantId,
        input.plugin,
        baseURL,
        signal,
      );

      // Org-owned (no principalId) so the catalog provider accepts a tenant-owned reference.
      const credential = (await request(`${root}/credentials`, signal, {
        providerId: nativeProvider.id,
        name: `${label} ${unique}`,
        type: "api_key",
        secret: input.secret,
        description: "Added through workspace model credentials",
      })) as { id: string; name: string };

      const modelProvider = (await request(
        `${root}/catalog/providers`,
        signal,
        {
          name: `${label} ${unique}`,
          plugin: input.plugin,
          baseURL,
          credentialId: credential.id,
        },
      )) as { id: string; name: string; credentialId: string | null };

      return {
        provider: {
          id: nativeProvider.id,
          name: `byok-${input.plugin}`,
          plugin: input.plugin,
          baseURL,
        },
        credential: { id: credential.id, name: credential.name },
        modelProvider: {
          id: modelProvider.id,
          name: modelProvider.name,
          credentialId: modelProvider.credentialId,
        },
      };
    },
  };
}
