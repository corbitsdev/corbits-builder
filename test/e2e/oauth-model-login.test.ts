import { expect, test } from "bun:test";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import postgres from "postgres";
import {
  createDB,
  listVisibleOfferings,
  resolveInferenceMaterials,
  resolveSourcesByOfferingIds,
} from "@intx/db";
import { createAgentRepoStore, createAssetService } from "@intx/hub-sessions";
import { createEnvKeyCredentialCipher, generateKeyPair } from "@intx/crypto";
import { hexDecode } from "@intx/types";
import { createHubRuntime } from "@corbits-builder/hub/app";
import { readDatabaseConfig } from "@corbits-builder/hub/environment";
import { migrateDatabase } from "@corbits-builder/hub/migrate";
import { installForTenant } from "@corbits-builder/hub/workflows/install-for-tenant";
import {
  MODEL_PROVIDERS,
  frozenModelChoice,
} from "@corbits-builder/hub/config/models";
import { defaultSettings } from "@corbits-builder/hub/settings/policy";
import type { ModelChoice } from "@corbits-builder/schemas/models";
import { createProductApiClient } from "@corbits-builder/client";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required e2e environment: ${name}`);
  return value;
}

const jwt = (claims: object) =>
  [{ alg: "none" }, claims]
    .map((part) => Buffer.from(JSON.stringify(part)).toString("base64url"))
    .join(".") + ".signature";

// Everything a "Login with ChatGPT" / "Login with xAI" does after the person approves on the
// provider's consent screen, through the real hub API on real Postgres. Only the two token
// endpoints are faked; the redirect is the request the browser makes to the loopback callback.
test("ChatGPT and xAI logins are providers a profile binds roles to, and installs resolve them", async () => {
  const database = {
    host: required("E2E_DB_HOST"),
    port: Number(required("E2E_DB_PORT")),
    username: required("E2E_DB_USER"),
    password: required("E2E_DB_PASSWORD"),
  };
  const dbName = `sb_oauth_${randomUUID().replaceAll("-", "")}`;
  const admin = postgres({
    ...database,
    database: "postgres",
    max: 1,
    onnotice: () => undefined,
  });
  await admin.unsafe(`create database ${dbName}`);
  const directory = await mkdtemp(join(tmpdir(), "sb-oauth-login-"));
  const tokens = {
    codex: jwt({
      sub: "codex-user",
      "https://api.openai.com/auth": { chatgpt_account_id: "acct-e2e" },
    }),
    xai: jwt({ sub: "xai-user-e2e" }),
  };
  const credentialKey = randomBytes(32).toString("hex");
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
    CREDENTIAL_ENCRYPTION_KEY: credentialKey,
    PRINCIPAL_KEY_ENCRYPTION_KEY: randomBytes(32).toString("hex"),
    HUB_DATA_DIR: join(directory, "hub"),
  };
  const realFetch = globalThis.fetch;
  const tokenEndpoints = {
    codex: "https://auth.openai.com/oauth/token",
    xai: "https://auth.x.ai/oauth2/token",
  } as const;
  const exchanges: string[] = [];
  globalThis.fetch = (async (
    input: Request | URL | string,
    init?: RequestInit,
  ) => {
    const url = String(input instanceof Request ? input.url : input);
    const provider = (["codex", "xai"] as const).find((plugin) =>
      url.startsWith(tokenEndpoints[plugin]),
    );
    if (!provider) return realFetch(input, init);
    const body = new URLSearchParams(String(init?.body));
    exchanges.push(
      `${provider}:${body.get("grant_type")}:${body.get("code")}:${Boolean(body.get("code_verifier"))}`,
    );
    return Response.json({
      access_token: tokens[provider],
      refresh_token: `${provider}-refresh`,
      expires_in: 3600,
      ...(provider === "codex" ? { id_token: tokens.codex } : {}),
    });
  }) as typeof fetch;
  let runtime: Awaited<ReturnType<typeof createHubRuntime>> | undefined;
  try {
    await migrateDatabase(environment);
    runtime = await createHubRuntime(environment);
    const responses: string[] = [];
    const call = async (path: string, init: RequestInit = {}) => {
      const response = await runtime!.app.fetch(
        new Request(`${origin}${path}`, {
          ...init,
          headers: {
            origin,
            "content-type": "application/json",
            ...init.headers,
          },
        }),
      );
      responses.push(await response.clone().text());
      return response;
    };
    const signUp = await call("/api/auth/sign-up/email", {
      method: "POST",
      body: JSON.stringify({
        email: `oauth-${dbName}@example.invalid`,
        password: randomBytes(16).toString("hex"),
        name: "OAuth e2e",
      }),
    });
    expect(signUp.status).toBe(200);
    const cookie = signUp.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ");
    const created = await call("/api/tenants", {
      method: "POST",
      headers: { cookie },
      body: JSON.stringify({
        name: "OAuth e2e",
        slug: dbName.replaceAll("_", "-"),
      }),
    });
    expect(created.status).toBe(201);
    const tenantId = ((await created.json()) as { id: string }).id;
    const client = createProductApiClient({
      baseUrl: origin,
      headers: { cookie, origin },
      fetch: async (request) => {
        const response = await runtime!.app.fetch(request);
        responses.push(await response.clone().text());
        return response;
      },
    });
    const authorize = {
      codex: {
        host: "auth.openai.com",
        redirect: "http://localhost:1455/auth/callback",
      },
      xai: { host: "auth.x.ai", redirect: "http://127.0.0.1:1456/callback" },
    } as const;
    const credentialIds: Record<string, string> = {};
    for (const plugin of ["codex", "xai"] as const) {
      const connection = `Builder ${plugin} login`;
      const login = await client.startModelLogin(tenantId, plugin, connection);
      const url = new URL(login.authorizeUrl);
      expect(url.host).toBe(authorize[plugin].host);
      expect(url.searchParams.get("redirect_uri")).toBe(
        authorize[plugin].redirect,
      );
      expect(url.searchParams.get("code_challenge_method")).toBe("S256");
      expect(await client.modelLogin(tenantId, login.loginId)).toEqual({
        status: "pending",
      });
      // What the browser does once the person approves: the provider redirects to the loopback.
      const callback = new URL(authorize[plugin].redirect);
      callback.searchParams.set("code", `${plugin}-code`);
      callback.searchParams.set("state", url.searchParams.get("state")!);
      expect((await realFetch(callback)).status).toBe(200);
      let state = await client.modelLogin(tenantId, login.loginId);
      for (let i = 0; i < 100 && state.status === "pending"; i++) {
        await Bun.sleep(20);
        state = await client.modelLogin(tenantId, login.loginId);
      }
      if (state.status !== "completed")
        throw new Error(`${plugin} login did not complete`);
      credentialIds[plugin] = state.credentialId;
      await client.finishModelLogin(
        tenantId,
        plugin,
        state.credentialId,
        connection,
      );
    }
    expect(exchanges).toEqual([
      "codex:authorization_code:codex-code:true",
      "xai:authorization_code:xai-code:true",
    ]);

    const sql = postgres({
      ...database,
      database: dbName,
      max: 1,
      onnotice: () => undefined,
    });
    let principalId: string;
    try {
      const [principal] =
        await sql`select id from principal where tenant_id = ${tenantId} and kind = 'user'`;
      principalId = String(principal!.id);
      const rows = await sql`
        select id, principal_id, type, secret, refresh_secret, metadata from credential
        where id in ${sql(Object.values(credentialIds))}`;
      expect(rows).toHaveLength(2);
      for (const row of rows) {
        expect(row.principal_id).toBeNull();
        expect(row.type).toBe("oauth_token");
        expect(String(row.secret)).not.toContain(".");
        expect(String(row.secret)).not.toBe(tokens.codex);
      }
      const metadata = Object.fromEntries(
        rows.map((row) => [row.id, row.metadata]),
      );
      expect(metadata[credentialIds.codex!]).toMatchObject({
        accountId: "acct-e2e",
        oauthProvider: "codex",
      });
      expect(metadata[credentialIds.xai!]).toMatchObject({
        userId: "xai-user-e2e",
        oauthProvider: "xai",
      });
    } finally {
      await sql.end();
    }

    const providers = await client.modelProviders(tenantId);
    expect(
      providers
        .filter((row) => !row.disabled)
        .map((row) => row.plugin)
        .sort(),
    ).toEqual(["codex", "xai"]);
    const catalog = await client.modelCatalog(tenantId);
    const listed = Object.fromEntries(
      catalog.providers.map((entry) => [entry.id, entry]),
    );
    expect(catalog.providers.map((entry) => [entry.id, entry.kind])).toEqual([
      ["openai", "api_key"],
      ["anthropic", "api_key"],
      ["google", "api_key"],
      ["xai-api", "api_key"],
      ["codex", "login"],
      ["xai", "login"],
    ]);
    for (const plugin of ["codex", "xai"])
      expect(
        listed[plugin]!.connections.map((connection) => connection.status),
      ).toEqual(["connected"]);
    expect(listed.codex!.models.map((entry) => entry.id)).toContain("gpt-5.5");
    expect(listed.xai!.models.map((entry) => entry.id)).toContain("grok-4.7");
    // Two logins and no choice: the person picks a profile before a coordinator starts.
    expect(catalog.unresolved?.code).toBe("model_profile_required");
    const keyTest = await call(
      `/api/tenants/${tenantId}/settings/providers/test`,
      {
        method: "POST",
        headers: { cookie },
        body: JSON.stringify({
          plugin: "codex",
          baseURL: listed.codex!.baseURL,
          secret: "not-a-key",
        }),
      },
    );
    expect(keyTest.status).toBe(400);
    expect(((await keyTest.json()) as { code: string }).code).toBe(
      "provider_signs_in",
    );

    const logins: ModelChoice = {
      profile: "logins",
      custom: [
        {
          id: "logins",
          label: "Logins",
          tiers: {
            low: { provider: "codex", model: "gpt-6-luna", effort: "low" },
            medium: { provider: "xai", model: "grok-4.7", effort: "low" },
            high: { provider: "codex", model: "gpt-5.5", effort: "max" },
            max: { provider: "codex", model: "gpt-6-sol", effort: "high" },
          },
        },
      ],
    };
    const mine = await client.personalSettings(tenantId);
    const saved = await client.savePersonalSettings(tenantId, {
      command: "save_settings",
      idempotencyKey: randomUUID(),
      fields: {
        models: {
          value: logins,
          baseVersion: mine.fields.models?.version ?? 0,
        },
      },
    });
    expect(saved.savedFields).toEqual(["models"]);
    const chosen =
      (await client.personalSettings(tenantId)).fields.models?.value ?? null;
    expect(chosen).toEqual(logins);

    // The install a project start runs: each role pins an offering serving its bound source.
    // Starting a real project would launch its coordinator's sidecar, so the project's settings
    // row is the one create_project writes: the creator's choice, frozen.
    const handle = createDB(readDatabaseConfig(environment));
    try {
      const actor = { tenantId, principalId };
      const projectId = `p-${randomUUID().replaceAll("-", "")}`;
      const fields = {
        ...defaultSettings(),
        models: {
          value: frozenModelChoice(MODEL_PROVIDERS, chosen),
          version: 1,
        },
      };
      const projectSql = postgres({
        ...database,
        database: dbName,
        max: 1,
        onnotice: () => undefined,
      });
      try {
        await projectSql`insert into sb_settings (tenant_id, scope_key, fields)
          values (${tenantId}, ${`project:${projectId}`}, ${projectSql.json(fields)})`;
      } finally {
        await projectSql.end();
      }
      const repoStore = createAgentRepoStore({
        dataDir: join(directory, "repos"),
        signingKey: await generateKeyPair(),
      });
      const installed = await installForTenant(
        {
          db: handle.db,
          assets: createAssetService({
            db: handle.db,
            repoStore: repoStore.repoStore,
          }),
        },
        actor,
        projectId,
      );
      const visible = await listVisibleOfferings(handle.db, tenantId);
      const served = (role: keyof typeof installed) => {
        if (role === "schemaVersion") throw new Error("not a role");
        const row = visible.find(
          (entry) =>
            entry.offering.id === installed[role].defaultSourceOfferingId,
        )!;
        return {
          plugin: row.provider.plugin,
          model: row.model.canonicalName,
          quirks: row.offering.quirks,
        };
      };
      expect(served("coder")).toEqual({
        plugin: "codex",
        model: "gpt-5.5",
        quirks: {
          productName: "Builder",
          environmentTagName: "builder_environment",
          accountId: "acct-e2e",
        },
      });
      expect(served("coordinator")).toEqual({
        plugin: "xai",
        model: "grok-4.7",
        quirks: { userId: "xai-user-e2e" },
      });
      const cipher = createEnvKeyCredentialCipher(hexDecode(credentialKey));
      const sources = await resolveSourcesByOfferingIds(
        handle.db,
        tenantId,
        [
          installed.coder.defaultSourceOfferingId,
          installed.coordinator.defaultSourceOfferingId,
        ],
        cipher,
      );
      if (!sources.ok)
        throw new Error(`sources did not resolve: ${sources.reason}`);
      expect(
        sources.sources.map((source) => [
          source.provider,
          source.model,
          source.baseURL,
        ]),
      ).toEqual([
        ["codex", "gpt-5.5", "https://chatgpt.com/backend-api"],
        ["xai", "grok-4.7", "https://cli-chat-proxy.grok.com/v1"],
      ]);
      // The secret each source's credential delivers to a sidecar is the login's access token.
      const materials = await resolveInferenceMaterials(
        handle.db,
        tenantId,
        sources.sources.map((source) => source.credentialId),
        cipher,
      );
      expect(materials.map((material) => material.secret)).toEqual([
        tokens.codex,
        tokens.xai,
      ]);
    } finally {
      await handle.close();
    }
    for (const body of responses)
      for (const secret of [
        ...Object.values(tokens),
        "codex-refresh",
        "xai-refresh",
      ])
        expect(body.includes(secret)).toBe(false);
  } finally {
    globalThis.fetch = realFetch;
    await runtime?.close();
    await admin.unsafe(`drop database if exists ${dbName} with (force)`);
    await admin.end();
    await rm(directory, { recursive: true, force: true });
  }
}, 180_000);
