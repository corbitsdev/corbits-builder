import { and, eq, inArray } from "drizzle-orm";
import type { Context } from "hono";
import { type } from "arktype";
import { listVisibleProviders, type DB } from "@intx/db";
import { credential, modelProvider, provider } from "@intx/db/schema";
import type { TenantEnv } from "@intx/hub-api";
import { getLogger } from "@intx/log";
import {
  CustomApi,
  CustomModel,
  type CustomProviderCreate,
  type CustomProviderUpdate,
} from "@corbits-builder/schemas/models";
import {
  CUSTOM_APIS,
  MODEL_PROVIDERS,
  type ModelDirectory,
} from "../config/models.ts";
import { customModelProvider } from "../db/schema.ts";
import { ProjectError } from "../projects/errors.ts";
import { readJson } from "../lib/json.ts";
import { requestErrorMetadata } from "../request-error.ts";

const log = getLogger(["corbits-builder", "hub", "custom-providers"]);
const storedModels = CustomModel.array();
const Created = type({ id: "string" });
const NativeError = type({ error: { code: "string" } });
const NATIVE_REFUSALS = [400, 403, 404, 409, 413] as const;
// Interchange requires a key on every catalog connection; a keyless server is sent this one.
const KEYLESS_SECRET = "builder-keyless";

/** The shipped providers and each custom provider this tenant sees, with its models. */
export async function modelDirectory(
  db: DB["db"],
  tenantId: string,
): Promise<ModelDirectory> {
  const rows = (await listVisibleProviders(db, tenantId)).map(({ row }) => row);
  if (rows.length === 0) return MODEL_PROVIDERS;
  const saved = await db
    .select()
    .from(customModelProvider)
    .where(
      inArray(
        customModelProvider.modelProviderId,
        rows.map((row) => row.id),
      ),
    );
  return [
    ...MODEL_PROVIDERS,
    ...saved.flatMap((entry) => {
      const row = rows.find(({ id }) => id === entry.modelProviderId);
      if (!row) return [];
      const models = storedModels(entry.models);
      if (models instanceof type.errors) {
        log.warn("Skipping custom provider {id}: stored models are invalid", {
          id: entry.id,
          errors: models.summary,
        });
        return [];
      }
      return [
        {
          id: entry.id,
          plugin: row.plugin,
          kind: "custom" as const,
          connection: row.id,
          keyless: entry.keyless,
          label: entry.name,
          hint: CUSTOM_APIS[CustomApi.assert(row.plugin)],
          needsBaseUrl: true,
          baseURL: row.baseURL,
          models,
        },
      ];
    }),
  ];
}

type Native = (
  method: "POST" | "DELETE",
  path: string,
  body?: Record<string, unknown>,
) => Promise<unknown>;

/**
 * Interchange's own provider, credential and catalog routes, called as the person, so their checks,
 * grant cleanup and pushes to running agents happen as they do for any other provider.
 */
export function nativeCatalog(
  c: Context<TenantEnv>,
  nativeFetch: (request: Request) => Promise<Response>,
): Native {
  const root = `/api/tenants/${encodeURIComponent(c.get("tenant").id)}`;
  return async (method, path, body) => {
    const headers = new Headers({ "content-type": "application/json" });
    for (const name of ["cookie", "authorization"]) {
      const value = c.req.header(name);
      if (value) headers.set(name, value);
    }
    const response = await nativeFetch(
      new Request(new URL(`${root}${path}`, c.req.url).href, {
        method,
        headers,
        ...(body ? { body: JSON.stringify(body) } : {}),
      }),
    );
    const refusal = NATIVE_REFUSALS.find((code) => code === response.status);
    if (refusal) {
      const refused = NativeError(await readJson(response));
      throw new ProjectError(
        refusal,
        refused instanceof type.errors ? "catalog_refused" : refused.error.code,
      );
    }
    if (!response.ok)
      throw new Error(`catalog_write_failed:${method}:${response.status}`);
    return response.status === 204 ? undefined : readJson(response);
  };
}

const at = (path: string, id: string) => `${path}/${encodeURIComponent(id)}`;

// What a custom provider runs on: its catalog connection, that connection's key, and the native
// provider the key is pinned to.
type Connection = Readonly<{
  modelProviderId: string;
  credentialId: string;
  originId: string;
}>;

/** Runs every step, so one failure leaves none of the others undone, and returns the failures. */
async function everyStep(
  steps: readonly (() => Promise<unknown>)[],
): Promise<unknown[]> {
  const failures: unknown[] = [];
  for (const step of steps)
    try {
      await step();
    } catch (error) {
      failures.push(error);
    }
  return failures;
}

function withCleanup(error: unknown, failures: readonly unknown[]): unknown {
  return failures.length === 0
    ? error
    : new AggregateError(
        [error, ...failures],
        "custom_provider_cleanup_failed",
      );
}

// A credential reaches only its native provider's API origin, so each API and origin has one.
async function originProvider(
  db: DB["db"],
  native: Native,
  tenantId: string,
  api: CustomApi,
  baseURL: string,
): Promise<string> {
  const origin = new URL(baseURL).origin;
  const name = `byok-${api} ${origin}`;
  const [found] = await db
    .select({ id: provider.id })
    .from(provider)
    .where(and(eq(provider.tenantId, tenantId), eq(provider.name, name)));
  if (found) return found.id;
  return Created.assert(
    await native("POST", "/providers", {
      name,
      plugin: api,
      apiBaseUrl: origin,
    }),
  ).id;
}

async function dropUnusedOrigin(db: DB["db"], native: Native, id: string) {
  const [used] = await db
    .select({ id: credential.id })
    .from(credential)
    .where(eq(credential.providerId, id))
    .limit(1);
  if (!used) await native("DELETE", at("/providers", id));
}

/** A new catalog connection with its own key; a failed step undoes the ones before it. */
async function connect(
  db: DB["db"],
  native: Native,
  tenantId: string,
  connection: CustomProviderCreate["connection"],
): Promise<Connection> {
  const { api, baseURL } = connection;
  const originId = await originProvider(db, native, tenantId, api, baseURL);
  const undo: (() => Promise<unknown>)[] = [
    () => dropUnusedOrigin(db, native, originId),
  ];
  try {
    const credentialId = Created.assert(
      await native("POST", "/credentials", {
        providerId: originId,
        name: `custom-provider ${crypto.randomUUID()}`,
        type: "api_key",
        secret: "secret" in connection ? connection.secret : KEYLESS_SECRET,
      }),
    ).id;
    undo.unshift(() => native("DELETE", at("/credentials", credentialId)));
    const modelProviderId = Created.assert(
      await native("POST", "/catalog/providers", {
        name: `custom-provider ${crypto.randomUUID()}`,
        plugin: api,
        baseURL,
        credentialId,
      }),
    ).id;
    return { modelProviderId, credentialId, originId };
  } catch (error) {
    throw withCleanup(error, await everyStep(undo));
  }
}

function disconnect(db: DB["db"], native: Native, from: Connection) {
  return everyStep([
    () => native("DELETE", at("/catalog/providers", from.modelProviderId)),
    ...releaseKey(db, native, from),
  ]);
}

// The key and its origin, once nothing runs on them; leftovers are logged, not refused.
function releaseKey(db: DB["db"], native: Native, from: Connection) {
  return [
    () => native("DELETE", at("/credentials", from.credentialId)),
    () => dropUnusedOrigin(db, native, from.originId),
  ];
}

function logLeftovers(id: string, failures: readonly unknown[]) {
  for (const failure of failures)
    log.warn("Custom provider {id} left part of its old connection", {
      id,
      ...requestErrorMetadata(failure),
    });
}

/** A custom provider this tenant owns, with its connection; a parent's is not found. */
async function owned(
  db: DB["db"],
  tenantId: string,
  id: string,
): Promise<Connection> {
  const [row] = await db
    .select({
      modelProviderId: modelProvider.id,
      credentialId: credential.id,
      originId: credential.providerId,
    })
    .from(customModelProvider)
    .innerJoin(
      modelProvider,
      eq(modelProvider.id, customModelProvider.modelProviderId),
    )
    .innerJoin(credential, eq(credential.id, modelProvider.credentialId))
    .where(
      and(eq(customModelProvider.id, id), eq(modelProvider.tenantId, tenantId)),
    );
  if (!row) throw new ProjectError(404, "custom_provider_not_found");
  return row;
}

/** Makes the catalog connection and its key, then keeps the name and models beside them. */
export async function createCustomProvider(
  db: DB["db"],
  native: Native,
  tenantId: string,
  input: CustomProviderCreate,
): Promise<{ id: string }> {
  const connection = await connect(db, native, tenantId, input.connection);
  const id = crypto.randomUUID();
  try {
    await db.insert(customModelProvider).values({
      id,
      modelProviderId: connection.modelProviderId,
      name: input.name,
      models: input.models,
      keyless: "keyless" in input.connection,
    });
  } catch (error) {
    throw withCleanup(error, await disconnect(db, native, connection));
  }
  return { id };
}

/**
 * Renames a custom provider and replaces its models. A new connection is made first and the old
 * one removed once the provider runs on the new one, so a failed removal is logged, not refused.
 */
export async function updateCustomProvider(
  db: DB["db"],
  native: Native,
  tenantId: string,
  id: string,
  input: CustomProviderUpdate,
): Promise<void> {
  const current = await owned(db, tenantId, id);
  const saved = { name: input.name, models: input.models };
  const where = eq(customModelProvider.id, id);
  if (!input.connection) {
    await db.update(customModelProvider).set(saved).where(where);
    return;
  }
  const next = await connect(db, native, tenantId, input.connection);
  try {
    await db
      .update(customModelProvider)
      .set({
        ...saved,
        modelProviderId: next.modelProviderId,
        keyless: "keyless" in input.connection,
      })
      .where(where);
  } catch (error) {
    throw withCleanup(error, await disconnect(db, native, next));
  }
  logLeftovers(id, await disconnect(db, native, current));
}

/**
 * Removes a custom provider's connection, and its name and models with it; the key is then
 * released best effort.
 */
export async function removeCustomProvider(
  db: DB["db"],
  native: Native,
  tenantId: string,
  id: string,
): Promise<void> {
  const current = await owned(db, tenantId, id);
  await native("DELETE", at("/catalog/providers", current.modelProviderId));
  logLeftovers(id, await everyStep(releaseKey(db, native, current)));
}
