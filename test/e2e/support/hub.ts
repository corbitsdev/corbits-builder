import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import postgres from "postgres";
import {
  createProductApiClient,
  type ProductApiClient,
} from "@corbits-builder/client";
import { createHubRuntime } from "@corbits-builder/hub/app";
import { migrateDatabase } from "@corbits-builder/hub/migrate";
import type { RecordedModelServer } from "./recorded-model.ts";

export type TestHubHandle = Readonly<{
  baseUrl: string;
  workspaceTenantId: string;
  client: ProductApiClient;
  fakeCredentialSecret: string;
  subscribeRunStream: (
    projectTenantId: string,
    runId: string,
    onFrame: (event: string, data: string) => void,
  ) => () => void;
  close: () => Promise<void>;
}>;

function readTestDbServerConfig(): {
  host: string;
  port: number;
  user: string;
  password: string;
  adminDatabase: string;
} {
  const host = process.env["E2E_DB_HOST"] ?? "127.0.0.1";
  const port = Number(process.env["E2E_DB_PORT"] ?? "5434");
  const user = process.env["E2E_DB_USER"] ?? "corbits_builder_test";
  const password = process.env["E2E_DB_PASSWORD"] ?? "corbits_builder_test";
  const adminDatabase = process.env["E2E_DB_ADMIN_DB"] ?? "postgres";

  if ((port === 5432 || port === 5433) && user === "corbits_builder") {
    throw new Error(
      "Refusing to run E2E pipeline test against the development database.",
    );
  }
  return { host, port, user, password, adminDatabase };
}

async function signUpSessionCookie(
  baseUrl: string,
  email: string,
  password: string,
  name: string,
): Promise<string> {
  const response = await fetch(new URL("/api/auth/sign-up/email", baseUrl), {
    method: "POST",
    redirect: "error",
    headers: {
      "Content-Type": "application/json",
      Origin: baseUrl,
    },
    body: JSON.stringify({ email, password, name }),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`E2E sign-up failed (${response.status}): ${body}`);
  }
  const cookies = response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";", 1)[0])
    .filter((cookie): cookie is string => Boolean(cookie));
  await response.body?.cancel();
  if (cookies.length === 0) {
    throw new Error("E2E sign-up did not return a session cookie");
  }
  return cookies.join("; ");
}

// An empty database of its own on the e2e server, with the hub's DB_* settings for it.
export async function createTestDatabase(): Promise<{
  env: Record<string, string>;
  drop: () => Promise<void>;
}> {
  const dbServer = readTestDbServerConfig();
  const dbName = `builder_e2e_${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`;
  const admin = async (statement: string) => {
    const adminSql = postgres({
      host: dbServer.host,
      port: dbServer.port,
      user: dbServer.user,
      password: dbServer.password,
      database: dbServer.adminDatabase,
      max: 1,
      onnotice: () => undefined,
    });
    try {
      await adminSql.unsafe(statement);
    } finally {
      await adminSql.end();
    }
  };
  await admin(`CREATE DATABASE "${dbName}"`);
  return {
    env: {
      DB_HOST: dbServer.host,
      DB_PORT: String(dbServer.port),
      DB_USER: dbServer.user,
      DB_PASSWORD: dbServer.password,
      DB_NAME: dbName,
      DB_SSL: "false",
    },
    drop: () => admin(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`),
  };
}

export async function startTestHub(
  recordedModel: RecordedModelServer,
): Promise<TestHubHandle> {
  const database = await createTestDatabase();

  const dataDir = await mkdtemp(join(tmpdir(), "builder-e2e-hub-"));
  const fakeCredentialSecret = `sk-fake-e2e-secret-${crypto.randomUUID()}`;

  // Auth and sidecar origin configuration require the hub's loopback port before createHubRuntime boots.
  const probeServer = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => new Response("probe"),
  });
  const port = probeServer.port;
  await probeServer.stop(true);
  if (port === undefined) {
    throw new Error("Failed to allocate ephemeral port for E2E hub");
  }

  const baseUrl = `http://127.0.0.1:${port}`;
  const hubEnv: Record<string, string> = {
    ...(process.env["PATH"] ? { PATH: process.env["PATH"] } : {}),
    HOME: process.env["HOME"] ?? tmpdir(),
    USER: process.env["USER"] ?? "e2e",
    TMPDIR: process.env["TMPDIR"] ?? tmpdir(),
    ...database.env,
    HOST: "127.0.0.1",
    PORT: String(port),
    BETTER_AUTH_BASE_URL: baseUrl,
    HUB_PUBLIC_URL: baseUrl,
    HUB_API_ORIGIN: baseUrl,
    UI_PUBLIC_URL: baseUrl,
    HUB_DATA_DIR: dataDir,
    CREDENTIAL_ENCRYPTION_KEY:
      "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    PRINCIPAL_KEY_ENCRYPTION_KEY:
      "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210",
    BETTER_AUTH_SECRET:
      "e2e-better-auth-secret-at-least-32-characters-long-123456",
    GOOGLE_EMULATE_URL: "http://127.0.0.1:9999",
    COORDINATOR_START_TIMEOUT_MS: "120000",
  };

  let runtime: Awaited<ReturnType<typeof createHubRuntime>> | undefined;
  let server: ReturnType<typeof Bun.serve> | undefined;
  const activeStreams = new Set<AbortController>();

  try {
    await migrateDatabase(hubEnv);
    runtime = await createHubRuntime(hubEnv);
    server = Bun.serve({
      hostname: runtime.hostname,
      port: runtime.port,
      fetch: runtime.app.fetch,
      websocket: runtime.websocket,
    });
    runtime.start();

    const cookie = await signUpSessionCookie(
      baseUrl,
      "e2e@corbits.dev",
      "e2e-password-123456",
      "E2E Builder",
    );

    const client = createProductApiClient({
      baseUrl,
      headers: {
        Cookie: cookie,
        Origin: baseUrl,
      },
    });

    const workspace = await client.createWorkspace({
      name: "E2E Replay Workspace",
    });
    const workspaceTenantId = workspace.id;

    const customProvider = await client.createCustomProvider(
      workspaceTenantId,
      {
        name: "Recorded Replay",
        models: [
          {
            id: "recorded-replay",
            label: "Recorded Replay",
            contextWindow: 400_000,
            maxOutputTokens: 128_000,
          },
        ],
        connection: {
          api: "openai-compatible",
          baseURL: `${recordedModel.url}/v1`,
          secret: fakeCredentialSecret,
        },
      },
    );

    const binding = {
      provider: customProvider.id,
      model: "recorded-replay",
      effort: "high" as const,
    };

    await client.savePersonalSettings(workspaceTenantId, {
      command: "save_settings",
      idempotencyKey: crypto.randomUUID(),
      fields: {
        models: {
          baseVersion: 0,
          value: {
            profile: "recorded_replay",
            custom: [
              {
                id: "recorded_replay",
                label: "Recorded Replay",
                tiers: {
                  low: binding,
                  medium: binding,
                  high: binding,
                  max: binding,
                },
              },
            ],
          },
        },
      },
    });

    function subscribeRunStream(
      projectTenantId: string,
      runId: string,
      onFrame: (event: string, data: string) => void,
    ): () => void {
      const controller = new AbortController();
      activeStreams.add(controller);

      async function pump(): Promise<void> {
        const streamUrl = new URL(
          `/api/tenants/${encodeURIComponent(projectTenantId)}/workflows/runs/${encodeURIComponent(runId)}/stream`,
          baseUrl,
        );
        try {
          const response = await fetch(streamUrl, {
            headers: {
              Cookie: cookie,
              Accept: "text/event-stream",
            },
            signal: controller.signal,
          });
          if (!response.ok || !response.body) return;
          const reader = response.body
            .pipeThrough(new TextDecoderStream())
            .getReader();
          let buffer = "";
          while (!controller.signal.aborted) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += value;
            let boundary = buffer.indexOf("\n\n");
            while (boundary >= 0) {
              const rawFrame = buffer.slice(0, boundary);
              buffer = buffer.slice(boundary + 2);
              boundary = buffer.indexOf("\n\n");
              let eventName = "message";
              const dataLines: string[] = [];
              for (const line of rawFrame.split("\n")) {
                if (line.startsWith("event:")) {
                  eventName = line.slice("event:".length).trim();
                } else if (line.startsWith("data:")) {
                  dataLines.push(line.slice("data:".length).trim());
                }
              }
              onFrame(eventName, dataLines.join("\n"));
            }
          }
        } catch (error) {
          if (!controller.signal.aborted) {
            throw error;
          }
        }
      }

      void pump();

      return () => {
        controller.abort();
        activeStreams.delete(controller);
      };
    }

    return {
      baseUrl,
      workspaceTenantId,
      client,
      fakeCredentialSecret,
      subscribeRunStream,
      close: async () => {
        for (const controller of activeStreams) {
          controller.abort();
        }
        activeStreams.clear();
        if (server) await server.stop(true);
        if (runtime) await runtime.close();
        await rm(dataDir, { recursive: true, force: true });
        await database.drop();
      },
    };
  } catch (error) {
    for (const controller of activeStreams) {
      controller.abort();
    }
    activeStreams.clear();
    if (server) await server.stop(true);
    if (runtime) await runtime.close();
    await rm(dataDir, { recursive: true, force: true });
    await database.drop();
    throw error;
  }
}
