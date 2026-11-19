import { afterAll, beforeAll, expect, test } from "bun:test";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { cp, rm, symlink } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { Server, utils } from "ssh2";
import { toolConsumer } from "@intx/authz";
import { createNoopCredentialCipher } from "@intx/crypto";
import { createRunTokenStore } from "@intx/db";
import { grant } from "@intx/db/schema";
import { CredentialResponse, ProviderResponse } from "@intx/types";
import type { ServerKeyState } from "@corbits-builder/schemas/settings";
import { hostKeyPair } from "./support/host-keys.ts";
import { runOnServer } from "./support/run-on-server.ts";

// The provider and the credential the hub saves the key under.
const NAME = "plugin.hoster-server";
const KEYS = "/run-credentials/hoster-server";

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
const otherHostKeys = hostKeyPair();

function fingerprintOf(publicKey: string) {
  const parsed = utils.parseKey(publicKey);
  if (parsed instanceof Error) throw parsed;
  return `SHA256:${createHash("sha256").update(parsed.getPublicSSH()).digest("base64").replace(/=+$/, "")}`;
}
const FINGERPRINT = fingerprintOf(hostKeys.public);

// A rented server on this machine: it signs in only the keys put on it, and answers every command
// with "ran", keeping each one it ran.
function startServer() {
  const authorized: Buffer[] = [];
  const commands: string[] = [];
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
        accept().on("exec", (acceptExec, _reject, info) => {
          commands.push(info.command);
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
    commands: string[];
    authorize(publicKey: string): void;
    close(): void;
  }>((resolve) =>
    server.listen(0, "127.0.0.1", () =>
      resolve({
        port: (server.address() as AddressInfo).port,
        commands,
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

// A project, and a hoster run there the coordinator started for `action`, live unless said, with the
// project read its package's grant requirements give it and its own hub token.
async function hosterRun(
  hub: Hub,
  action: string,
  project?: Awaited<ReturnType<Hub["seedProject"]>>,
  running = true,
) {
  const seeded = project ?? (await hub.seedProject("Hosted"));
  const run = await hub.seedRun(seeded.person, "hoster", running);
  await hub.call("POST", `${seeded.path}/run-actions`, {
    runId: run.id,
    plugin: "hoster",
    action,
  });
  await hub.db.insert(grant).values({
    id: randomUUID(),
    tenantId: seeded.person.tenantId,
    principalId: run.principalId,
    resource: `sb-project:${seeded.projectId}`,
    action: "read",
    effect: "allow",
    origin: "system",
  });
  const tokens = createRunTokenStore({
    db: hub.db,
    cipher: createNoopCredentialCipher(),
  });
  await tokens.mintIfAbsent(
    {
      principalId: run.principalId,
      consumers: [toolConsumer("@corbits-builder/hoster/tools")],
    },
    hub.db,
  );
  const [delivery] = await tokens.loadDelivery(run.principalId);
  const token = { authorization: `Bearer ${delivery!.token}` };
  const bodies: string[] = [];
  // What the run's call answered, or the error naming its status and body; every body kept.
  const ask = async (step: string, body: object = {}) => {
    try {
      const text = await (
        await hub.call("POST", `${seeded.path}${step}`, body, token)
      ).text();
      bodies.push(text);
      return JSON.parse(text) as unknown;
    } catch (error) {
      bodies.push(String(error));
      throw error;
    }
  };
  // What the run reads, as ask answers it.
  const look = async (step: string) =>
    JSON.parse(
      await (
        await hub.call("GET", `${seeded.path}${step}`, undefined, token)
      ).text(),
    ) as unknown;
  return { ...seeded, ask, look, bodies };
}

const key = async (run: Awaited<ReturnType<typeof hosterRun>>) =>
  (await run.ask(`${KEYS}/key`)) as ServerKeyState;
const heldKey = async (run: Awaited<ReturnType<typeof hosterRun>>) =>
  (await run.look(`${KEYS}/key`)) as ServerKeyState;
const bind = (
  run: Awaited<ReturnType<typeof hosterRun>>,
  body: Record<string, unknown>,
) => run.ask(`${KEYS}/bind`, body);
const refusal = (call: Promise<unknown>) =>
  call.then(
    () => "answered",
    (error: unknown) => String(error),
  );

// The credential of the name the project itself holds, as the person's session reads it; undefined
// for none.
async function held(hub: Hub, tenantId: string) {
  const response = await hub
    .call("GET", `/api/tenants/${tenantId}/credentials/resolve/${NAME}`)
    .catch((error: unknown) => {
      if (String(error).startsWith("Error: HTTP 404")) return undefined;
      throw error;
    });
  return response && CredentialResponse.assert(await response.json());
}

// A key a person saved for the name through Interchange, as the server key form does.
async function personsKey(hub: Hub, tenantId: string) {
  const provider = ProviderResponse.assert(
    await hub.json(
      hub.call("POST", `/api/tenants/${tenantId}/providers`, {
        name: NAME,
        plugin: "ssh",
        apiBaseUrl: "ssh://198.51.100.9:22",
      }),
    ),
  );
  return CredentialResponse.assert(
    await hub.json(
      hub.call("POST", `/api/tenants/${tenantId}/credentials`, {
        providerId: provider.id,
        name: NAME,
        type: "api_key",
        secret: "the person's own key",
        metadata: { publicKey: "ssh-ed25519 AAAA the person's" },
      }),
    ),
  );
}

// The hub's own record of the project's key: its stage, and the private half while it holds one.
const keyRow = async (tenantId: string) =>
  (await local.db.execute(
    sql`select stage, sealed_private_key from sb_server_key where tenant_id = ${tenantId}`,
  )) as unknown as Record<string, unknown>[];

const onServer = (port = server.port) => ({
  host: "127.0.0.1",
  port,
  hostKey: FINGERPRINT,
});

test("a run whose action provisions the key gets one key and label, the same on every ask, and never its private half", async () => {
  const run = await hosterRun(local, "create");
  // Reading the key before it is asked for makes none.
  expect(await refusal(heldKey(run))).toBe(
    'Error: HTTP 404: {"code":"server_key_not_issued"}',
  );
  expect(await keyRow(run.person.tenantId)).toEqual([]);
  const first = await key(run);
  expect(first).toEqual({
    publicKey: expect.stringMatching(
      /^ssh-ed25519 AAAAC3NzaC1lZDI1NTE5\S+ builder-[a-z0-9]{12}$/,
    ),
    label: expect.stringMatching(/^builder-[a-z0-9]{12}$/),
    state: "issued",
  });
  expect(await key(run)).toEqual(first);
  expect(await heldKey(run)).toEqual(first);
  // Another run of an action that provisions it reads the same key.
  const remover = await hosterRun(local, "remove", run);
  expect(await key(remover)).toEqual(first);

  const [row] = await keyRow(run.person.tenantId);
  expect(row?.["stage"]).toBe("issued");
  expect(row?.["sealed_private_key"]).not.toContain("PRIVATE KEY");
  expect(run.bodies.join("\n")).not.toContain("PRIVATE KEY");
}, 60_000);

test("only a live run of an action that provisions the name may ask for it", async () => {
  const publisher = await hosterRun(local, "publish");
  expect(await refusal(key(publisher))).toContain(
    'HTTP 403: {"code":"run_credential_not_provisioned"',
  );
  expect(await refusal(heldKey(publisher))).toContain(
    'HTTP 403: {"code":"run_credential_not_provisioned"',
  );
  const creator = await hosterRun(local, "create");
  expect(await refusal(creator.ask("/run-credentials/hoster/key"))).toContain(
    'HTTP 403: {"code":"run_credential_not_provisioned"',
  );
  const ended = await hosterRun(local, "create", undefined, false);
  expect(await refusal(key(ended))).toContain(
    'HTTP 403: {"code":"run_not_live"',
  );
  // Nor the person, whose session may not make a server key through a run's route.
  expect(
    await refusal(local.call("POST", `${creator.path}${KEYS}/key`, {})),
  ).toContain('HTTP 403: {"code":"run_not_started_for_an_action"');
  expect(await held(local, publisher.person.tenantId)).toBeUndefined();
}, 60_000);

test("a bind names a public IP address and a host key fingerprint, and a hub as deployed reaches nothing private", async () => {
  const run = await hosterRun(local, "create");
  await key(run);
  expect(
    await refusal(bind(run, { host: "127.0.0.1", port: server.port })),
  ).toBe('Error: HTTP 400: {"code":"invalid_bind"}');
  expect(await refusal(bind(run, { ...onServer(), host: "localhost" }))).toBe(
    'Error: HTTP 400: {"code":"invalid_address"}',
  );

  const deployed = await hosterRun(strict, "create");
  await key(deployed);
  expect(await refusal(bind(deployed, onServer()))).toBe(
    'Error: HTTP 422: {"code":"address_refused"}',
  );
  expect(
    await refusal(bind(deployed, { ...onServer(), host: "203.0.113.7" })),
  ).toBe('Error: HTTP 422: {"code":"address_refused"}');
  expect(await held(local, run.person.tenantId)).toBeUndefined();
  expect(await held(strict, deployed.person.tenantId)).toBeUndefined();
}, 60_000);

// A run that made the project's key, put it on the server and bound it there.
async function boundRun() {
  const run = await hosterRun(local, "create");
  const issued = await key(run);
  server.authorize(issued.publicKey);
  await bind(run, onServer());
  return { run, issued };
}

test("a bind saves nothing while the server does not take the key", async () => {
  const run = await hosterRun(local, "create");
  const issued = await key(run);
  expect(await refusal(bind(run, onServer()))).toBe(
    'Error: HTTP 502: {"code":"server_refused_key"}',
  );
  expect(await held(local, run.person.tenantId)).toBeUndefined();
  expect(await key(run)).toEqual(issued);
}, 60_000);

test("a bind to a server presenting another host key runs nothing there and saves nothing", async () => {
  const run = await hosterRun(local, "create");
  const issued = await key(run);
  server.authorize(issued.publicKey);
  const before = server.commands.length;
  expect(
    await refusal(
      bind(run, {
        ...onServer(),
        hostKey: fingerprintOf(otherHostKeys.public),
      }),
    ),
  ).toBe('Error: HTTP 502: {"code":"server_host_key_mismatch"}');
  expect(server.commands.length).toBe(before);
  expect(await held(local, run.person.tenantId)).toBeUndefined();
  expect(await key(run)).toEqual(issued);
}, 60_000);

test("a bind the key signs in with saves it as the project's ssh credential to that server, and forgets its private half", async () => {
  const run = await hosterRun(local, "create");
  const issued = await key(run);
  server.authorize(issued.publicKey);
  const before = server.commands.length;
  expect(await bind(run, onServer())).toEqual({
    ...issued,
    state: "bound",
    address: "127.0.0.1",
  });
  expect(server.commands.slice(before)).toEqual(["'true'"]);
  const saved = await held(local, run.person.tenantId);
  expect(saved).toMatchObject({
    name: NAME,
    tenantId: run.person.tenantId,
    principalId: null,
    status: "active",
    metadata: { publicKey: issued.publicKey },
  });
  const provider = ProviderResponse.assert(
    await local.json(
      local.call(
        "GET",
        `/api/tenants/${run.person.tenantId}/providers/${saved!.providerId}`,
      ),
    ),
  );
  expect(provider).toMatchObject({
    name: NAME,
    tenantId: run.person.tenantId,
    plugin: "ssh",
    apiBaseUrl: `ssh://127.0.0.1:${String(server.port)}`,
  });
  expect(await keyRow(run.person.tenantId)).toEqual([
    { stage: "bound", sealed_private_key: null },
  ]);
  expect(run.bodies.join("\n")).not.toContain("PRIVATE KEY");
}, 60_000);

test("a bound key bound again to the same server proves and saves nothing more, and another server is not its", async () => {
  const { run } = await boundRun();
  const saved = await held(local, run.person.tenantId);
  const before = server.commands.length;
  expect(await bind(run, onServer())).toEqual(await key(run));
  expect(server.commands.length).toBe(before);
  expect((await held(local, run.person.tenantId))?.updatedAt).toBe(
    saved!.updatedAt,
  );
  expect(
    await refusal(
      bind(run, {
        ...onServer(),
        hostKey: fingerprintOf(otherHostKeys.public),
      }),
    ),
  ).toBe('Error: HTTP 409: {"code":"server_key_bound_elsewhere"}');
}, 60_000);

test("a run of the plugin's other action reaches the server with the bound key", async () => {
  const { run } = await boundRun();
  expect(
    await runOnServer(local.db, CREDENTIAL_KEY, run.person.tenantId, {
      package: "@corbits-builder/hoster/tools",
      handle: "hoster-server",
      provider: NAME,
      locator: "tenant",
      optional: true,
    }),
  ).toMatchObject({ code: 0, stdout: "ran" });
}, 60_000);

test("a key whose credential a person revoked reads as lost, and the run's revoke removes only its own", async () => {
  const run = await hosterRun(local, "create");
  const issued = await key(run);
  server.authorize(issued.publicKey);
  await bind(run, onServer());
  const tenantId = run.person.tenantId;
  // Revoked in Settings, which takes the server's provider row with the key.
  const saved = await held(local, tenantId);
  await local.call(
    "DELETE",
    `/api/tenants/${tenantId}/credentials/${saved!.id}`,
  );
  await local.call(
    "DELETE",
    `/api/tenants/${tenantId}/providers/${saved!.providerId}`,
  );
  expect(await key(run)).toEqual({
    ...issued,
    state: "lost",
    address: "127.0.0.1",
  });

  // A person connects a server of their own under the name; the run reads it as not its key, and
  // its revoke forgets only its own.
  const persons = await personsKey(local, tenantId);
  expect(await refusal(key(run))).toBe(
    'Error: HTTP 409: {"code":"server_key_taken"}',
  );
  expect(await run.ask(`${KEYS}/revoke`)).toEqual({ revoked: true });
  expect(await held(local, tenantId)).toMatchObject({
    id: persons.id,
    status: "active",
  });
  expect(await refusal(key(run))).toBe(
    'Error: HTTP 409: {"code":"server_key_taken"}',
  );
  expect(await run.ask(`${KEYS}/revoke`)).toEqual({ revoked: false });
}, 60_000);

test("a run never takes over a key a person saved, and its revoke removes the key and server it made", async () => {
  const connected = await hosterRun(local, "create");
  const persons = await personsKey(local, connected.person.tenantId);
  expect(await refusal(key(connected))).toBe(
    'Error: HTTP 409: {"code":"server_key_taken"}',
  );
  expect(await held(local, connected.person.tenantId)).toMatchObject({
    id: persons.id,
  });

  // A person saves a key after the run's was issued: the bind refuses before it reaches the server.
  const raced = await hosterRun(local, "create");
  const issued = await key(raced);
  server.authorize(issued.publicKey);
  const racing = await personsKey(local, raced.person.tenantId);
  const before = server.commands.length;
  expect(await refusal(bind(raced, onServer()))).toBe(
    'Error: HTTP 409: {"code":"server_key_taken"}',
  );
  expect(server.commands.length).toBe(before);
  expect(await held(local, raced.person.tenantId)).toMatchObject({
    id: racing.id,
    metadata: racing.metadata,
  });

  const made = await hosterRun(local, "create");
  const first = await key(made);
  server.authorize(first.publicKey);
  await bind(made, onServer());
  const remover = await hosterRun(local, "remove", made);
  expect(await remover.ask(`${KEYS}/revoke`)).toEqual({ revoked: true });
  expect(await held(local, made.person.tenantId)).toBeUndefined();
  const providers = (
    await local.json<{ data: { name: string }[] }>(
      local.call(
        "GET",
        `/api/tenants/${made.person.tenantId}/providers?inherited=false`,
      ),
    )
  ).data;
  expect(providers.map(({ name }) => name)).not.toContain(NAME);
  // The next ask makes a new key.
  const next = await key(remover);
  expect(next.state).toBe("issued");
  expect(next.publicKey).not.toBe(first.publicKey);
  expect(next.label).not.toBe(first.label);
}, 60_000);
