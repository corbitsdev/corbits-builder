import { expect, test } from "bun:test";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import postgres from "postgres";
import { createDB, listVisibleOfferings } from "@intx/db";
import { createAgentRepoStore, createAssetService } from "@intx/hub-sessions";
import { generateKeyPair } from "@intx/crypto";
import { createHubRuntime } from "@corbits-builder/hub/app";
import { readDatabaseConfig } from "@corbits-builder/hub/environment";
import { migrateDatabase } from "@corbits-builder/hub/migrate";
import { installForTenant } from "@corbits-builder/hub/workflows/install-for-tenant";
import { defaultSettings } from "@corbits-builder/hub/settings/policy";
import type { CustomModel, ModelChoice } from "@corbits-builder/schemas/models";
import {
  ProductApiError,
  createProductApiClient,
} from "@corbits-builder/client";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required e2e environment: ${name}`);
  return value;
}

// A fake endpoint that answers the OpenAI and Anthropic model lists and records each key it is sent.
function fakeEndpoint() {
  const seen: (string | null)[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      seen.push(
        request.headers.get("authorization") ??
          request.headers.get("x-api-key"),
      );
      return new URL(request.url).pathname === "/v1/models"
        ? Response.json({ data: [{ id: "local-model" }] })
        : new Response(null, { status: 404 });
    },
  });
  return { seen, server, origin: `http://127.0.0.1:${server.port}` };
}

// A person adds their own endpoints, each on the API it speaks, binds a profile to their models,
// and a project's install pins offerings at those endpoints. A key stays on its origin, edits reach
// only the workspace that owns the provider, and removing it leaves nothing in the catalog. The
// endpoints are local fakes; the keys are fake.
test("custom providers install on their API, keep each key on its origin, and remove cleanly", async () => {
  const database = {
    host: required("E2E_DB_HOST"),
    port: Number(required("E2E_DB_PORT")),
    username: required("E2E_DB_USER"),
    password: required("E2E_DB_PASSWORD"),
  };
  const dbName = `sb_custom_${randomUUID().replaceAll("-", "")}`;
  const admin = postgres({
    ...database,
    database: "postgres",
    max: 1,
    onnotice: () => undefined,
  });
  await admin.unsafe(`create database ${dbName}`);
  const directory = await mkdtemp(join(tmpdir(), "sb-custom-provider-"));
  const fake = () => `fake-custom-${randomBytes(8).toString("hex")}`;
  const [key, second, replacement] = [fake(), fake(), fake()];
  const home = fakeEndpoint();
  const elsewhere = fakeEndpoint();
  const origin = "http://127.0.0.1:1";
  const environment: Record<string, string> = {
    NODE_ENV: "test",
    HOST: "127.0.0.1",
    // Never bound: requests go straight to the app.
    PORT: "1",
    DB_HOST: database.host,
    DB_PORT: String(database.port),
    DB_USER: database.username,
    DB_PASSWORD: database.password,
    DB_NAME: dbName,
    DB_SSL: "false",
    BETTER_AUTH_BASE_URL: origin,
    BETTER_AUTH_SECRET: randomBytes(32).toString("hex"),
    CREDENTIAL_ENCRYPTION_KEY: randomBytes(32).toString("hex"),
    PRINCIPAL_KEY_ENCRYPTION_KEY: randomBytes(32).toString("hex"),
    HUB_DATA_DIR: join(directory, "hub"),
  };
  let runtime: Awaited<ReturnType<typeof createHubRuntime>> | undefined;
  const sql = postgres({
    ...database,
    database: dbName,
    max: 1,
    onnotice: () => undefined,
  });
  try {
    await migrateDatabase(environment);
    runtime = await createHubRuntime(environment);
    const app = runtime.app;
    const responses: string[] = [];
    const signUp = await app.fetch(
      new Request(`${origin}/api/auth/sign-up/email`, {
        method: "POST",
        headers: { origin, "content-type": "application/json" },
        body: JSON.stringify({
          email: `custom-${dbName}@example.invalid`,
          password: randomBytes(16).toString("hex"),
          name: "Custom e2e",
        }),
      }),
    );
    expect(signUp.status).toBe(200);
    const cookie = signUp.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ");
    const workspace = async (name: string) => {
      const created = await app.fetch(
        new Request(`${origin}/api/tenants`, {
          method: "POST",
          headers: { origin, cookie, "content-type": "application/json" },
          body: JSON.stringify({
            name,
            slug: `${name}-${dbName}`.replaceAll("_", "-").toLowerCase(),
          }),
        }),
      );
      expect(created.status).toBe(201);
      return ((await created.json()) as { id: string }).id;
    };
    const tenantId = await workspace("Custom");
    const client = createProductApiClient({
      baseUrl: origin,
      headers: { cookie, origin },
      fetch: async (request) => {
        const response = await app.fetch(request);
        responses.push(await response.clone().text());
        return response;
      },
    });
    const refusal = async (work: Promise<unknown>) => {
      try {
        await work;
      } catch (error) {
        if (!(error instanceof ProductApiError)) throw error;
        return {
          status: error.response.status,
          ...((await error.response.clone().json()) as object),
        };
      }
      throw new Error("expected a refusal");
    };
    const catalogRows = async () => {
      const [row] = await sql`select
        (select count(*)::int from provider where name like 'byok-% http%') as providers,
        (select count(*)::int from credential where name like 'custom-provider %') as credentials,
        (select count(*)::int from model_provider where name like 'custom-provider %') as connections,
        (select count(*)::int from sb_custom_model_provider) as kept`;
      return { ...row };
    };

    const local = {
      id: "local-model",
      label: "Local Model",
      contextWindow: 131072,
      maxOutputTokens: 16384,
    } satisfies CustomModel;
    const keyed = await client.createCustomProvider(tenantId, {
      name: "Local",
      models: [local],
      connection: {
        api: "openai-compatible",
        baseURL: `${home.origin}/v1`,
        secret: key,
      },
    });
    const messages = await client.createCustomProvider(tenantId, {
      name: "Messages",
      models: [local],
      connection: { api: "anthropic", baseURL: home.origin, secret: second },
    });
    expect(await catalogRows()).toEqual({
      providers: 2,
      credentials: 2,
      connections: 2,
      kept: 2,
    });

    // Reading settings sends nothing to a custom endpoint; the availability route probes on demand.
    const catalog = await client.modelCatalog(tenantId);
    expect(home.seen).toEqual([]);
    const listed = catalog.providers.find((entry) => entry.id === keyed.id)!;
    expect(listed).toMatchObject({
      kind: "custom",
      plugin: "openai-compatible",
      label: "Local",
      models: [local],
    });
    expect(listed.connections).toEqual([
      {
        id: expect.any(String),
        name: "Local",
        credentialSet: true,
        keyless: false,
      },
    ]);
    const connection = listed.connections[0]!.id;
    const availability = await app.fetch(
      new Request(
        `${origin}/api/tenants/${tenantId}/availability/models/${connection}`,
        { headers: { origin, cookie } },
      ),
    );
    expect(await availability.json()).toMatchObject({ state: "connected" });
    expect(home.seen).toEqual([`Bearer ${key}`]);
    expect(catalog.unresolved?.code).toBe("model_profile_custom");

    const tiers = {
      low: { provider: messages.id, model: local.id, effort: "low" },
      medium: { provider: keyed.id, model: local.id, effort: "medium" },
      high: { provider: keyed.id, model: local.id, effort: "high" },
      max: { provider: keyed.id, model: local.id, effort: "max" },
    } as const;
    const choice: ModelChoice = {
      profile: "mine",
      custom: [{ id: "mine", label: "Mine", tiers }],
    };
    const mine = await client.personalSettings(tenantId);
    const saved = await client.savePersonalSettings(tenantId, {
      command: "save_settings",
      idempotencyKey: randomUUID(),
      fields: {
        models: {
          value: choice,
          baseVersion: mine.fields.models?.version ?? 0,
        },
      },
    });
    expect(saved.savedFields).toEqual(["models"]);

    // The install a project start runs, on the project settings row create_project writes. A
    // second install finds the first current and leaves the workspace config as it was.
    const handle = createDB(readDatabaseConfig(environment));
    const projectId = `p-${randomUUID().replaceAll("-", "")}`;
    try {
      const [principal] =
        await sql`select id from principal where tenant_id = ${tenantId} and kind = 'user'`;
      await sql`insert into sb_settings (tenant_id, scope_key, fields)
        values (${tenantId}, ${`project:${projectId}`}, ${sql.json({ ...defaultSettings(), models: { value: choice, version: 1 } })})`;
      const signingKey = await generateKeyPair();
      const install = () =>
        installForTenant(
          {
            db: handle.db,
            assets: createAssetService({
              db: handle.db,
              repoStore: createAgentRepoStore({
                dataDir: join(directory, "repos"),
                signingKey,
              }).repoStore,
            }),
          },
          { tenantId, principalId: String(principal!.id) },
          projectId,
        );
      const installed = await install();
      const config = async () =>
        (await sql`select config from tenant where id = ${tenantId}`)[0]!
          .config;
      const first = await config();
      await install();
      expect(await config()).toEqual(first);
      const visible = await listVisibleOfferings(handle.db, tenantId);
      const pinned = (role: "coder" | "reviewer") => {
        const offering = visible.find(
          (entry) =>
            entry.offering.id === installed[role].defaultSourceOfferingId,
        )!;
        return {
          model: offering.model.canonicalName,
          plugin: offering.provider.plugin,
          baseURL: offering.provider.baseURL,
        };
      };
      expect(pinned("coder")).toEqual({
        model: local.id,
        plugin: "openai-compatible",
        baseURL: `${home.origin}/v1`,
      });
      expect(pinned("reviewer")).toEqual({
        model: local.id,
        plugin: "anthropic",
        baseURL: home.origin,
      });
    } finally {
      await handle.close();
    }

    // An edit without a connection renames and replaces models on the same connection.
    const renamed = { ...local, id: "renamed-model", label: "Renamed" };
    await client.updateCustomProvider(tenantId, keyed.id, {
      name: "Local renamed",
      models: [renamed],
    });
    const edited = (await client.modelCatalog(tenantId)).providers.find(
      (entry) => entry.id === keyed.id,
    )!;
    expect(edited).toMatchObject({ label: "Local renamed", models: [renamed] });
    expect(edited.connections[0]!.id).toBe(connection);

    // A new origin is a new connection with its own key; the provider keeps its id, the old key
    // is gone, and neither origin is sent the other's key.
    await client.updateCustomProvider(tenantId, keyed.id, {
      name: "Local renamed",
      models: [renamed],
      connection: {
        api: "openai-compatible",
        baseURL: `${elsewhere.origin}/v1`,
        secret: replacement,
      },
    });
    const moved = (await client.modelCatalog(tenantId)).providers.find(
      (entry) => entry.id === keyed.id,
    )!;
    expect(moved.baseURL).toBe(`${elsewhere.origin}/v1`);
    const movedConnection = moved.connections[0]!.id;
    expect(movedConnection).not.toBe(connection);
    await app.fetch(
      new Request(
        `${origin}/api/tenants/${tenantId}/availability/models/${movedConnection}`,
        { headers: { origin, cookie } },
      ),
    );
    expect(elsewhere.seen).toEqual([`Bearer ${replacement}`]);
    expect(home.seen).not.toContain(`Bearer ${replacement}`);
    expect(await catalogRows()).toEqual({
      providers: 2,
      credentials: 2,
      connections: 2,
      kept: 2,
    });

    // Another workspace of the same person cannot edit or remove it.
    const other = await workspace("Other");
    expect(
      await refusal(
        client.updateCustomProvider(other, keyed.id, {
          name: "Taken",
          models: [local],
        }),
      ),
    ).toMatchObject({ status: 404, code: "custom_provider_not_found" });
    expect(
      await refusal(client.removeCustomProvider(other, keyed.id)),
    ).toMatchObject({ status: 404, code: "custom_provider_not_found" });

    // A server that needs no key is tested with none, and connects keyless.
    const asked = home.seen.length;
    expect(
      await client.testProvider(tenantId, {
        plugin: "openai-compatible",
        baseURL: `${home.origin}/v1`,
        keyless: true,
      }),
    ).toEqual({ status: "connected" });
    expect(home.seen.slice(asked)).toEqual([null]);
    const unnamed = {
      id: local.id,
      contextWindow: 8192,
      maxOutputTokens: 1024,
    };
    const keyless = await client.createCustomProvider(tenantId, {
      name: "Keyless",
      models: [unnamed],
      connection: {
        api: "openai-compatible",
        baseURL: `${home.origin}/v1`,
        keyless: true,
      },
    });
    expect(
      (await client.modelCatalog(tenantId)).providers.find(
        (entry) => entry.id === keyless.id,
      ),
    ).toMatchObject({
      models: [unnamed],
      connections: [
        {
          id: expect.any(String),
          name: "Keyless",
          credentialSet: true,
          keyless: true,
        },
      ],
    });

    // Removing a provider a profile binds is allowed; the profile then stops being runnable.
    await client.removeCustomProvider(tenantId, keyed.id);
    await client.removeCustomProvider(tenantId, messages.id);
    await client.removeCustomProvider(tenantId, keyless.id);
    expect(await catalogRows()).toEqual({
      providers: 0,
      credentials: 0,
      connections: 0,
      kept: 0,
    });
    for (const body of responses)
      for (const secret of [key, second, replacement])
        expect(body.includes(secret)).toBe(false);
  } finally {
    await sql.end();
    await runtime?.close();
    await home.server.stop(true);
    await elsewhere.server.stop(true);
    await admin.unsafe(`drop database if exists ${dbName} with (force)`);
    await admin.end();
    await rm(directory, { recursive: true, force: true });
  }
}, 180_000);
