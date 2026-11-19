import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import { createHash, randomBytes } from "node:crypto";
import { cp, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { and, eq, sql } from "drizzle-orm";
import { createEnvKeyCredentialCipher } from "@intx/crypto";
import { credential, principal, provider, workflowRun } from "@intx/db/schema";
import { hexDecode } from "@intx/types";
import type {
  PluginSignInStarted,
  PluginSignInState,
} from "@corbits-builder/schemas/settings";

// The provider and the credential a sign-in saves the token under.
const NAME = "plugin.hoster";

// The answers the authorization server gives, which nothing the hub answers may repeat.
const CODE = "code-from-the-provider";
const FIRST = { access: "access-first", refresh: "refresh-first" };
const RENEWED = { access: "access-renewed", refresh: "refresh-renewed" };

// Hoster's authorization server and API on this machine: it registers clients, answers the code it
// was given for the PKCE verifier its challenge was made from, renews tokens, and revokes them,
// keeping every request it got. An address another one points a credential at counts its calls too.
const got: {
  path: string;
  form: URLSearchParams;
  authorization: string | null;
}[] = [];
// The client ids the server registered, in order.
const issued: string[] = [];
let revokeAnswers = 200;
const challenges = new Map<string, string>();
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch: async (request) => {
    const path = new URL(request.url).pathname;
    const text = await request.text();
    const form = new URLSearchParams(
      request.headers.get("content-type")?.includes("json") ? "" : text,
    );
    got.push({
      path,
      form,
      authorization: request.headers.get("authorization"),
    });
    if (path === "/oauth/register") {
      const client = `client-${String(issued.length + 1)}`;
      issued.push(client);
      return Response.json({ client_id: client }, { status: 201 });
    }
    if (path === "/oauth/revoke")
      return new Response(null, { status: revokeAnswers });
    if (
      path === "/oauth/token" &&
      form.get("grant_type") === "authorization_code"
    ) {
      const verifier = form.get("code_verifier") ?? "";
      const challenge = createHash("sha256")
        .update(verifier)
        .digest("base64url");
      if (form.get("code") !== CODE || !challenges.has(challenge))
        return Response.json({ error: "invalid_grant" }, { status: 400 });
      return Response.json({
        access_token: FIRST.access,
        refresh_token: FIRST.refresh,
        expires_in: 3600,
        info: {
          name: "Ann Example",
          email: "ann@example.com",
          uuid: "user-1",
          team_uuid: "team-1",
          team_name: "Acme team",
        },
      });
    }
    if (path === "/oauth/token" && form.get("grant_type") === "refresh_token")
      return Response.json({
        access_token: RENEWED.access,
        refresh_token: RENEWED.refresh,
        expires_in: 3600,
      });
    return Response.json({ error: "invalid_request" }, { status: 400 });
  },
});
const ORIGIN = `http://127.0.0.1:${String(server.port)}`;

// The hub reads its plugins once, from the repository's plugins folder, when it loads. The fixture
// that signs in is copied there, its provider being this file's server, and resolves its imports
// through the hub's own dependencies.
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
const manifest = await Bun.file(join(INSTALLED, "package.json")).json();
const declared = manifest.builder.credentials.hoster;
declared.origin = ORIGIN;
Object.assign(declared.signIn, {
  authorize: `${ORIGIN}/oauth/authorize`,
  token: `${ORIGIN}/oauth/token`,
  revoke: `${ORIGIN}/oauth/revoke`,
  client: { register: `${ORIGIN}/oauth/register` },
});
await writeFile(join(INSTALLED, "package.json"), JSON.stringify(manifest));
const { startInProcessHub } = await import("./support/in-process-hub.ts");
const { CATALOG } = await import("@corbits-builder/hub/plugins/catalog");
const { createPluginSignIns, signInCredentials } =
  await import("@corbits-builder/hub/credentials/sign-ins");
const { runsHolding, startTokenRefresher } =
  await import("@corbits-builder/hub/credentials/refresher");

const CREDENTIAL_KEY = randomBytes(32).toString("hex");
let hub: Awaited<ReturnType<typeof startInProcessHub>>;
let workspace: string;
// Every body the hub answered the person with.
const answered: string[] = [];

beforeAll(async () => {
  hub = await startInProcessHub({ CREDENTIAL_ENCRYPTION_KEY: CREDENTIAL_KEY });
  workspace = (
    await json<{ id: string }>("POST", "/api/tenants", {
      name: "Workspace",
      slug: `ws-${randomBytes(6).toString("hex")}`,
    })
  ).id;
}, 120_000);

afterAll(async () => {
  await hub?.close();
  await server.stop(true);
  await rm(INSTALLED, { recursive: true, force: true });
});

// What the hub answered, or the error naming its status and body; every body kept.
async function send(
  method: "GET" | "POST",
  path: string,
  body?: object,
  credentials?: Record<string, string>,
) {
  try {
    const text = await (await hub.call(method, path, body, credentials)).text();
    answered.push(text);
    return text;
  } catch (error) {
    answered.push(String(error));
    throw error;
  }
}
const json = async <T>(
  method: "GET" | "POST",
  path: string,
  body?: object,
  credentials?: Record<string, string>,
) => JSON.parse(await send(method, path, body, credentials)) as T;
const refusal = (call: Promise<unknown>) =>
  call.then(
    () => "answered",
    (error: unknown) => String(error),
  );

// A project of the workspace, in a tenant of its own, as the hub makes one.
async function project() {
  const slug = `p-${randomBytes(6).toString("hex")}`;
  const { id: tenantId } = await json<{ id: string }>("POST", "/api/tenants", {
    name: slug,
    slug,
    parentId: workspace,
  });
  await hub.db.execute(
    sql`insert into project (id, tenant_id, title) values (${slug}, ${tenantId}, 'Hosted')`,
  );
  return tenantId;
}

const signIns = (tenant: string) => `/api/tenants/${tenant}/plugin-sign-ins`;

// Starts a sign-in and notes the PKCE challenge the provider would keep from its address.
async function start(tenant: string) {
  const started = await json<PluginSignInStarted>("POST", signIns(tenant), {
    credential: "hoster",
  });
  const url = new URL(started.url);
  challenges.set(url.searchParams.get("code_challenge")!, started.id);
  return { ...started, address: url };
}

// The provider sends the person's browser back with the code for the sign-in's state.
const callback = (
  started: { address: URL },
  credentials?: Record<string, string>,
  query = `code=${CODE}`,
) =>
  send(
    "GET",
    `/api/oauth/callback?state=${started.address.searchParams.get("state")!}&${query}`,
    undefined,
    credentials,
  );

const held = async (tenant: string) =>
  (
    await hub.db
      .select()
      .from(credential)
      .where(and(eq(credential.tenantId, tenant), eq(credential.name, NAME)))
  )[0];

const tokenCalls = () => got.filter(({ path }) => path === "/oauth/token");

// No answer the hub gave carries a code, a token or a verifier, checked after each test for the
// answers it was given.
let checked = 0;
afterEach(() => {
  const fresh = answered.slice(checked);
  checked = answered.length;
  const verifiers = tokenCalls().flatMap(({ form }) => {
    const verifier = form.get("code_verifier");
    return verifier ? [verifier] : [];
  });
  for (const body of fresh)
    for (const secret of [
      CODE,
      FIRST.access,
      FIRST.refresh,
      RENEWED.access,
      RENEWED.refresh,
      ...verifiers,
    ])
      expect(body).not.toContain(secret);
});

test("a sign-in opens the provider's page with the manifest's scopes, PKCE and the client the hub registered once, and a second reuses that client", async () => {
  const tenant = await project();
  const { address } = await start(tenant);
  expect(`${address.origin}${address.pathname}`).toBe(
    `${ORIGIN}/oauth/authorize`,
  );
  expect(Object.fromEntries(address.searchParams)).toMatchObject({
    response_type: "code",
    redirect_uri: "http://127.0.0.1:1/api/oauth/callback",
    scope: "machine:create machine:delete",
    code_challenge_method: "S256",
  });
  expect(address.searchParams.get("code_challenge")).toMatch(/^[\w-]{43}$/);
  const client = address.searchParams.get("client_id") ?? "";
  expect(issued).toContain(client);
  const registered = issued.length;
  const again = await start(await project());
  expect(again.address.searchParams.get("client_id")).toBe(client);
  expect(issued).toHaveLength(registered);
});

test("a sign-in is saved for one project, never a workspace", async () => {
  expect(
    await refusal(send("POST", signIns(workspace), { credential: "hoster" })),
  ).toContain('"code":"sign_in_project_only"');
});

test("a callback that comes back without the session of the person who started the sign-in exchanges nothing and fails it", async () => {
  const tenant = await project();
  const other = await hub.seedProject("Someone else's");
  const { cookie } = await hub.seedMember(other.person, other.projectId, []);
  const before = tokenCalls().length;
  for (const session of [{ cookie }, {}]) {
    const started = await start(tenant);
    const page = await refusal(callback(started, session));
    expect(page).toContain("HTTP 400");
    expect(page).toContain("The sign-in did not finish");
    expect(page).not.toContain(CODE);
    expect(
      await json<PluginSignInState>("GET", `${signIns(tenant)}/${started.id}`),
    ).toEqual({ status: "failed", code: "sign_in_other_session" });
  }
  expect(tokenCalls()).toHaveLength(before);
  expect(await held(tenant)).toBeUndefined();
});

test("a callback with the starter's session saves an active project-owned oauth_token under an http provider at the declared origin, keeping only strings and no email or token address", async () => {
  const tenant = await project();
  const started = await start(tenant);
  expect(await callback(started)).toContain("signed in. Close this tab");
  expect(
    await json<PluginSignInState>("GET", `${signIns(tenant)}/${started.id}`),
  ).toEqual({ status: "done" });
  const saved = await held(tenant);
  expect(saved).toMatchObject({
    tenantId: tenant,
    principalId: null,
    type: "oauth_token",
    status: "active",
    scopes: ["machine:create", "machine:delete"],
  });
  expect(saved?.metadata).toEqual({
    oauthProvider: NAME,
    account: "Acme team",
    accountId: "team-1",
  });
  const [through] = await hub.db
    .select()
    .from(provider)
    .where(eq(provider.id, saved!.providerId));
  expect(through).toMatchObject({
    tenantId: workspace,
    name: NAME,
    plugin: "http",
    apiBaseUrl: ORIGIN,
  });

  // Signing in again renews the same credential.
  await callback(await start(tenant));
  expect((await held(tenant))?.id).toBe(saved!.id);
});

test("signing in where a key was pasted replaces the key", async () => {
  const tenant = await project();
  const [workspaceProvider] = await hub.db
    .select()
    .from(provider)
    .where(and(eq(provider.tenantId, workspace), eq(provider.name, NAME)));
  const pasted = await json<{ id: string }>(
    "POST",
    `/api/tenants/${tenant}/credentials`,
    {
      providerId: workspaceProvider!.id,
      name: NAME,
      type: "api_key",
      secret: "a-pasted-key",
    },
  );
  await callback(await start(tenant));
  const saved = await held(tenant);
  expect(saved?.id).not.toBe(pasted.id);
  expect(saved?.type).toBe("oauth_token");
});

test("a renewal uses the manifest's token address and the hub's client even when the credential names another, and reaches the runs that hold it", async () => {
  const tenant = await project();
  const started = await start(tenant);
  await callback(started);
  const saved = (await held(tenant))!;
  // Anyone who may manage the credential may write its metadata.
  await hub.db
    .update(credential)
    .set({
      expiresAt: new Date(),
      metadata: {
        ...(saved.metadata as Record<string, string>),
        oauthClientId: "someone-elses-client",
        oauthTokenUrl: `${ORIGIN}/elsewhere/token`,
      },
    })
    .where(eq(credential.id, saved.id));
  const [person] = await hub.db
    .select({ tenantId: principal.tenantId, principalId: principal.id })
    .from(principal)
    .where(and(eq(principal.tenantId, tenant), eq(principal.kind, "user")));
  const holding = await hub.seedRun(person!, "hoster", true);
  // Another run of the project, which holds no sign-in.
  await hub.seedRun(person!, "hoster", true);
  await hub.db
    .update(workflowRun)
    .set({ credentialRefs: { credentialIds: [saved.id], bindings: [] } })
    .where(eq(workflowRun.id, holding.id));
  expect(await runsHolding(hub.db, workspace, saved.id)).toEqual([
    `${holding.id}@${tenant}.test`,
  ]);

  const renewed: string[] = [];
  const signIns = createPluginSignIns({
    db: hub.db,
    cipher: createEnvKeyCredentialCipher(hexDecode(CREDENTIAL_KEY)),
    credentials: signInCredentials(CATALOG.credentials),
    publicURL: new URL("http://127.0.0.1:1"),
    clientName: "Builder",
    pushRevoke: () => undefined,
    pushRenewed: () => undefined,
  });
  const refresher = startTokenRefresher({
    db: hub.db,
    cipher: createEnvKeyCredentialCipher(hexDecode(CREDENTIAL_KEY)),
    models: {},
    signIns: signIns.refreshers,
    pushRenewed: async (_tenant, id) => {
      renewed.push(id);
    },
  });
  try {
    for (let tries = 0; renewed.length === 0 && tries < 100; tries++)
      await Bun.sleep(50);
  } finally {
    refresher.stop();
  }
  expect(renewed).toEqual([saved.id]);
  const refreshed = tokenCalls().filter(
    ({ form }) => form.get("grant_type") === "refresh_token",
  );
  expect(refreshed.at(-1)?.form.get("client_id")).toBe(
    started.address.searchParams.get("client_id"),
  );
  expect(got.some(({ path }) => path === "/elsewhere/token")).toBe(false);
  expect((await held(tenant))?.expiresAt?.getTime()).toBeGreaterThan(
    Date.now() + 30 * 60 * 1000,
  );
});

test("disconnecting revokes the refresh and the access token at the provider, each in the form with the access token as bearer, and revokes the credential here, even when the provider fails", async () => {
  const tenant = await project();
  await callback(await start(tenant));
  const before = got.length;
  expect(
    await json("POST", `${signIns(tenant)}/disconnect`, {
      credential: "hoster",
    }),
  ).toEqual({ code: "disconnected" });
  const revoked = got
    .slice(before)
    .filter(({ path }) => path === "/oauth/revoke")
    .map(({ form, authorization }) => ({
      token: form.get("token"),
      authorization,
    }));
  expect(revoked).toEqual([
    { token: FIRST.refresh, authorization: `Bearer ${FIRST.access}` },
    { token: FIRST.access, authorization: `Bearer ${FIRST.access}` },
  ]);
  expect(await held(tenant)).toBeUndefined();

  await callback(await start(tenant));
  revokeAnswers = 503;
  try {
    expect(
      await json("POST", `${signIns(tenant)}/disconnect`, {
        credential: "hoster",
      }),
    ).toEqual({ code: "provider_may_hold_grant" });
  } finally {
    revokeAnswers = 200;
  }
  expect(await held(tenant)).toBeUndefined();
});
