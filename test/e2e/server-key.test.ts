import { afterAll, beforeAll, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { cp, rm, symlink } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { Server, utils } from "ssh2";
import { CredentialResponse, ProviderResponse } from "@intx/types";
import type { PersonServerKeyState } from "@corbits-builder/schemas/settings";
import { hostKeyPair } from "./support/host-keys.ts";
import { runOnServer } from "./support/run-on-server.ts";

// The server plugin's key, which a person connects on its screen, and the hoster fixture's, which
// its runs make.
const SERVER = "server";
const HOSTER = "hoster-server";

// The hub reads its plugins once, from the repository's plugins folder, when it loads. The fixture
// that declares a provisioned server key is copied there, and resolves its imports through the
// hub's own dependencies.
const ROOT = join(import.meta.dir, "../..");
const INSTALLED = join(ROOT, "plugins", "hoster");
await rm(INSTALLED, { recursive: true, force: true });
await cp(join(ROOT, "apps/hub/src/plugins/fixtures/hoster"), INSTALLED, {
  recursive: true,
});
await symlink(
  join(ROOT, "apps/hub/node_modules"),
  join(INSTALLED, "node_modules"),
);
const { startInProcessHub } = await import("./support/in-process-hub.ts");

const hostKeys = hostKeyPair();

// A person's server on this machine: it signs in only the keys put on it, and answers every command
// with "ran".
function startServer() {
  const authorized: Buffer[] = [];
  const server = new Server({ hostKeys: [hostKeys.private] }, (client) => {
    client.on("error", () => {});
    client.on("authentication", (context) => {
      if (
        context.method === "publickey" &&
        authorized.some((key) => context.key.data.equals(key))
      )
        context.accept();
      else context.reject(["publickey"]);
    });
    client.on("ready", () => {
      client.on("session", (accept) => {
        accept().on("exec", (acceptExec) => {
          const stream = acceptExec();
          stream.write("ran");
          stream.exit(0);
          stream.end();
        });
      });
    });
  });
  return new Promise<{
    port: number;
    authorize(publicKey: string): void;
    close(): void;
  }>((resolve) =>
    server.listen(0, "127.0.0.1", () =>
      resolve({
        port: (server.address() as AddressInfo).port,
        authorize: (publicKey) => {
          const parsed = utils.parseKey(publicKey);
          if (parsed instanceof Error) throw parsed;
          authorized.push(parsed.getPublicSSH());
        },
        close: () => server.close(),
      }),
    ),
  );
}

const CREDENTIAL_KEY = randomBytes(32).toString("hex");
let local: Awaited<ReturnType<typeof startInProcessHub>>;
let strict: Awaited<ReturnType<typeof startInProcessHub>>;
let server: Awaited<ReturnType<typeof startServer>>;

beforeAll(async () => {
  // A hub set to reach servers on private addresses, as in development, and one as deployed.
  [local, strict] = await Promise.all([
    startInProcessHub({
      SIDECAR_SSH_ALLOW_PRIVATE_ADDRESSES: "true",
      CREDENTIAL_ENCRYPTION_KEY: CREDENTIAL_KEY,
    }),
    startInProcessHub(),
  ]);
  server = await startServer();
}, 120_000);

afterAll(async () => {
  server?.close();
  await Promise.all([local?.close(), strict?.close()]);
  await rm(INSTALLED, { recursive: true, force: true });
});

type Hub = typeof local;

const answered = (call: Promise<unknown>) =>
  call.then(
    () => "answered",
    (error: unknown) => String(error),
  );

// What the person's form asks the hub, as the person unless other credentials are given; every
// body answered kept, to look for a private key in.
function person(
  hub: Hub,
  tenantId: string,
  credentials?: Record<string, string>,
) {
  const bodies: string[] = [];
  const ask = async (name: string, step: string, body?: object) => {
    try {
      const text = await (
        await hub.call(
          body === undefined ? "GET" : "POST",
          `/api/tenants/${tenantId}/server-keys/${name}/${step}`,
          body,
          credentials,
        )
      ).text();
      bodies.push(text);
      return JSON.parse(text) as PersonServerKeyState;
    } catch (error) {
      bodies.push(String(error));
      throw error;
    }
  };
  return {
    bodies,
    key: (body: object = {}, name = SERVER) => ask(name, "key", body),
    held: (name = SERVER) => ask(name, "key"),
    bind: (body: object, name = SERVER) => ask(name, "bind", body),
  };
}

const onServer = (port = server.port) => ({ host: "127.0.0.1", port });

// The credential of the name the project itself holds, as the person's session reads it; undefined
// for none.
async function held(hub: Hub, tenantId: string, name = SERVER) {
  const response = await hub
    .call("GET", `/api/tenants/${tenantId}/credentials/resolve/plugin.${name}`)
    .catch((error: unknown) => {
      if (String(error).startsWith("Error: HTTP 404")) return undefined;
      throw error;
    });
  return response && CredentialResponse.assert(await response.json());
}

// What one command on the server answers through the key a run of the server plugin binds.
const runOnServerPlugin = (tenantId: string) =>
  runOnServer(local.db, CREDENTIAL_KEY, tenantId, {
    package: "@corbits-builder/server/tools",
    handle: SERVER,
    provider: `plugin.${SERVER}`,
    locator: "tenant",
  });

test("the person is given a key with no private half, the same one until it is connected, and reading it makes none", async () => {
  const { person: owner } = await local.seedProject("Publish");
  const form = person(local, owner.tenantId);
  expect(await answered(form.held())).toBe(
    'Error: HTTP 404: {"code":"server_key_not_issued"}',
  );
  const issued = await form.key();
  expect(issued).toEqual({
    publicKey: expect.stringMatching(
      /^ssh-ed25519 AAAAC3NzaC1lZDI1NTE5\S+ builder-[a-z0-9]{12}$/,
    ),
    state: "issued",
  });
  expect(await form.key()).toEqual(issued);
  expect(await form.held()).toEqual(issued);
  const rows = (await local.db.execute(
    sql`select issuer, sealed_private_key from sb_server_key where tenant_id = ${owner.tenantId}`,
  )) as unknown as Record<string, unknown>[];
  expect(rows).toMatchObject([{ issuer: "person" }]);
  expect(rows[0]?.["sealed_private_key"]).not.toContain("PRIVATE KEY");
  expect(form.bodies.join("\n")).not.toContain("PRIVATE KEY");
  expect(await held(local, owner.tenantId)).toBeUndefined();
}, 60_000);

test("connecting saves nothing until the server accepts the key, then saves a key a run of the server plugin reaches it with", async () => {
  const { person: owner } = await local.seedProject("Publish");
  const form = person(local, owner.tenantId);
  const issued = await form.key();
  expect(await answered(form.bind(onServer()))).toBe(
    'Error: HTTP 502: {"code":"server_refused_key"}',
  );
  expect(await held(local, owner.tenantId)).toBeUndefined();
  expect(await form.key()).toEqual(issued);

  // The person adds the key at their hosting provider.
  server.authorize(issued.publicKey);
  const connected = {
    ...issued,
    state: "bound" as const,
    address: `127.0.0.1:${String(server.port)}`,
  };
  expect(await form.bind(onServer())).toEqual(connected);
  expect(await form.held()).toEqual(connected);
  const saved = await held(local, owner.tenantId);
  expect(saved).toMatchObject({
    tenantId: owner.tenantId,
    status: "active",
    metadata: { publicKey: issued.publicKey },
  });
  const provider = ProviderResponse.assert(
    await local.json(
      local.call(
        "GET",
        `/api/tenants/${owner.tenantId}/providers/${saved!.providerId}`,
      ),
    ),
  );
  expect(provider).toMatchObject({
    tenantId: owner.tenantId,
    plugin: "ssh",
    apiBaseUrl: `ssh://127.0.0.1:${String(server.port)}`,
  });
  expect(await runOnServerPlugin(owner.tenantId)).toMatchObject({
    code: 0,
    stdout: "ran",
  });
  expect(form.bodies.join("\n")).not.toContain("PRIVATE KEY");
}, 60_000);

test("asking for a key for another server leaves the connected one shown and working until that one is connected", async () => {
  const { person: owner } = await local.seedProject("Publish");
  const form = person(local, owner.tenantId);
  const first = await form.key();
  server.authorize(first.publicKey);
  const connected = await form.bind(onServer());

  const next = await form.key();
  expect(next).toEqual({ publicKey: expect.any(String), state: "issued" });
  expect(next.publicKey).not.toBe(first.publicKey);
  expect(await form.held()).toEqual(connected);
  expect(await held(local, owner.tenantId)).toMatchObject({
    status: "active",
    metadata: { publicKey: first.publicKey },
  });
  expect(await runOnServerPlugin(owner.tenantId)).toMatchObject({
    stdout: "ran",
  });

  server.authorize(next.publicKey);
  expect(await form.bind(onServer())).toEqual({
    ...connected,
    publicKey: next.publicKey,
  });
  expect(await held(local, owner.tenantId)).toMatchObject({
    metadata: { publicKey: next.publicKey },
  });
}, 60_000);

test("a key the hub makes for a plugin's runs is never a person's to read, make or connect", async () => {
  const { person: owner } = await local.seedProject("Hosted");
  const form = person(local, owner.tenantId);
  const unknown = 'Error: HTTP 404: {"code":"server_key_unknown"}';
  expect(await answered(form.held(HOSTER))).toBe(unknown);
  expect(await answered(form.key({}, HOSTER))).toBe(unknown);
  expect(await answered(form.bind(onServer(), HOSTER))).toBe(unknown);
}, 60_000);

test("an address a hub as deployed does not reach saves nothing", async () => {
  const { person: deployed } = await strict.seedProject("Publish");
  const strictForm = person(strict, deployed.tenantId);
  await strictForm.key();
  expect(await answered(strictForm.bind(onServer()))).toBe(
    'Error: HTTP 422: {"code":"address_refused"}',
  );
  expect(await held(strict, deployed.tenantId)).toBeUndefined();
}, 60_000);

test("a member who may not save a key to a server is given none and never has the hub reach one", async () => {
  const { person: owner, projectId } = await local.seedProject("Publish");
  const member = await local.seedMember(owner, projectId, ["read", "manage"]);
  const form = person(local, owner.tenantId, member);
  expect(await answered(form.key())).toContain("HTTP 403");
  expect(await answered(form.bind(onServer()))).toContain("HTTP 403");
  const rows = (await local.db.execute(
    sql`select id from sb_server_key where tenant_id = ${owner.tenantId}`,
  )) as unknown as unknown[];
  expect(rows).toEqual([]);
}, 60_000);
