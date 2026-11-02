import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import {
  createGrantStore,
  listVisibleProviders,
  resolveTenantOwnedCredentialById,
  resolveInferenceMaterials,
  type DB,
} from "@intx/db";
import {
  createRequireGrant,
  createResolveTenant,
  idResource,
  requireAuth,
  type TenantEnv,
} from "@intx/hub-api";
import { timeWindowEvaluator } from "@intx/authz";
import { getLogger } from "@intx/log";
import type { CredentialCipher } from "@intx/types";
import { requestContext } from "./middleware/correlation.ts";
import { requestErrorMetadata } from "./request-error.ts";

export type AvailabilityState =
  | "connected"
  | "unconfigured"
  | "unavailable"
  | "refused";
const log = getLogger(["corbits-builder", "availability"]);

// These are wire-protocol adapters, not a provider/model registry. Identity,
// endpoints, shadowing and credential authority all come from the native catalog.
function probeRequest(
  plugin: string,
  baseURL: string,
  secret: string | undefined,
) {
  const url = new URL(baseURL);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    return null;
  const headers = new Headers({ accept: "application/json" });
  switch (plugin) {
    case "openai":
    case "openai-responses":
    case "openai-compatible":
      url.pathname = `${url.pathname.replace(/\/$/, "")}/models`;
      if (secret !== undefined)
        headers.set("authorization", `Bearer ${secret}`);
      break;
    case "anthropic":
      url.pathname = `${url.pathname.replace(/\/$/, "")}/v1/models`;
      if (secret !== undefined) headers.set("x-api-key", secret);
      headers.set("anthropic-version", "2023-06-01");
      break;
    case "google-genai":
      url.pathname = `${url.pathname.replace(/\/$/, "")}/v1beta/models`;
      if (secret !== undefined) headers.set("x-goog-api-key", secret);
      break;
    default:
      return null;
  }
  const correlationId = requestContext.getStore()?.["correlationId"];
  if (typeof correlationId === "string")
    headers.set("x-correlation-id", correlationId);
  return { url, headers };
}

async function validModelList(
  response: Response,
  plugin: string,
): Promise<boolean> {
  if (!response.headers.get("content-type")?.includes("application/json"))
    return false;
  if (!response.body) return false;
  const reader = response.body.getReader();
  try {
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 1_000_000) return false;
      chunks.push(value);
    }
    const body: unknown = JSON.parse(Buffer.concat(chunks).toString());
    if (!body || typeof body !== "object") return false;
    const field = plugin === "google-genai" ? "models" : "data";
    return Array.isArray((body as Record<string, unknown>)[field]);
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export function createAvailabilityProbe(
  db: DB["db"],
  cipher: CredentialCipher,
) {
  return async (
    tenantId: string,
    providerId: string,
  ): Promise<AvailabilityState> => {
    const provider = (await listVisibleProviders(db, tenantId)).find(
      ({ row }) => row.id === providerId,
    )?.row;
    if (!provider) return "unconfigured";
    if (!provider.credentialId) return "unavailable"; // Native wallet transport has no probe here.
    const credential = await resolveTenantOwnedCredentialById(
      db,
      tenantId,
      provider.credentialId,
    );
    if (!credential) return "unconfigured";
    if (
      credential.status !== "active" ||
      (credential.expiresAt && credential.expiresAt <= new Date())
    )
      return "refused";
    // A login's token was issued by the provider's token endpoint and oauth-core's refresher
    // renews it; these backends expose no model list to probe it against.
    if (credential.type === "oauth_token") return "connected";
    if (credential.type !== "api_key") return "unavailable";
    // Decryption/database failures propagate as a correlated 500, not a false
    // assertion that the remote service refused a request that was never sent.
    const [material] = await resolveInferenceMaterials(
      db,
      tenantId,
      [credential.id],
      cipher,
    );
    if (!material) return "unconfigured";
    return probeKey(
      provider.plugin,
      provider.baseURL,
      material.secret,
      material.origin,
    );
  };
}

/**
 * One model-list call with this key, or with none for a keyless server; `origin`, when given, is
 * the only origin the key may reach.
 */
export async function probeKey(
  plugin: string,
  baseURL: string,
  secret: string | undefined,
  origin?: string,
): Promise<AvailabilityState> {
  let request;
  try {
    request = probeRequest(plugin, baseURL, secret);
  } catch {
    return "unavailable";
  }
  if (!request) return "unavailable";
  if (origin !== undefined && request.url.origin !== new URL(origin).origin)
    return "refused";
  let response: Response | undefined;
  try {
    response = await fetch(request.url, {
      headers: request.headers,
      redirect: "manual",
      signal: AbortSignal.timeout(3_000),
    });
    if (response.status === 401 || response.status === 403) return "refused";
    if (!response.ok) return "unavailable";
    return (await validModelList(response, plugin))
      ? "connected"
      : "unavailable";
  } catch (error) {
    // Never expose exception strings, provider bodies or URLs. No retries,
    // redirect following or alternate endpoint selection occurs in this probe.
    log.debug("Provider availability probe for {plugin} failed", {
      plugin,
      ...requestErrorMetadata(error),
    });
    return "unavailable";
  } finally {
    await response?.body?.cancel().catch(() => undefined);
  }
}

export function createAvailabilityRoutes(
  db: DB["db"],
  cipher: CredentialCipher,
) {
  const app = new Hono<TenantEnv>();
  const probe = createAvailabilityProbe(db, cipher);
  const requireGrant = createRequireGrant({
    grantStore: createGrantStore(db),
    conditionRegistry: { time_window: timeWindowEvaluator },
  });
  app.use("*", requireAuth, createResolveTenant({ db }));
  app.get(
    "/models/:providerId",
    requireGrant(idResource("model-provider", "providerId"), "read"),
    describeRoute({
      tags: ["Availability"],
      operationId: "modelProviderAvailability",
      security: [{ sessionCookie: [] }, { deviceBearer: [] }],
      description:
        "Probes only the requested visible native model provider. Connected means its model-list API responded, not that inference or workflow execution is qualified. No redirects or fallback. Unsupported probe protocols return unavailable.",
      parameters: ["tenantId", "providerId"].map((name) => ({
        name,
        in: "path" as const,
        required: true,
        schema: { type: "string" },
      })),
      responses: {
        200: {
          description: "Nonsecret provider status",
          content: {
            "application/json": {
              schema: {
                type: "object",
                additionalProperties: false,
                required: ["provider", "state"],
                properties: {
                  provider: { type: "string" },
                  state: {
                    type: "string",
                    enum: [
                      "connected",
                      "unconfigured",
                      "unavailable",
                      "refused",
                    ],
                  },
                },
              },
            },
          },
        },
        401: { description: "Authentication required" },
        403: {
          description:
            "Active principal and model-provider read grant required",
        },
        404: { description: "Tenant not found" },
        500: {
          description:
            "Local setup failure; correlation ID in response header and body",
        },
      },
    }),
    async (c) => {
      c.header("cache-control", "no-store");
      const provider = c.req.param("providerId");
      const state = await probe(c.get("tenant").id, provider);
      log.info("Provider availability {provider} {state}", { provider, state });
      return c.json({ provider, state });
    },
  );
  return app;
}
