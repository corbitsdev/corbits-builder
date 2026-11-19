import { expect, test } from "bun:test";
import { BuilderUnavailable } from "@corbits-builder/plugin/run-hub";
import type { AppBuildRefusal } from "@corbits-builder/schemas/app-files";
import { API, assetHash } from "./api.ts";
import { release, unpublish, type Deps, type Outcome } from "./cloudflare.ts";

// What must never reach a tool's answer: tokens, the link that keeps an app, upload tokens and
// anything Cloudflare wrote.
const TEMP_TOKEN = "cfat_TEMPORARY-ACCOUNT-TOKEN";
const CLAIM_URL = "https://dash.cloudflare.com/claim/CLAIM-SECRET";
const SESSION_JWT = "SESSION-UPLOAD-TOKEN";
const COMPLETION_JWT = "COMPLETION-UPLOAD-TOKEN";
const RAW = "RAW CLOUDFLARE WORDS";
const SECRETS = [
  TEMP_TOKEN,
  CLAIM_URL,
  "CLAIM-SECRET",
  SESSION_JWT,
  COMPLETION_JWT,
  RAW,
];

const VERSION = "0123456789abcdef0123456789abcdef01234567";
const START = new Date("2026-11-18T10:00:00.000Z");
const PRODUCTION = {
  install: "bun install --frozen-lockfile",
  build: "bun run build",
  start: "bun run start",
  port: "PORT",
  data: ["server/data"],
};
const WRANGLER = `{
  "name": "app",
  // Built by bun run build.
  "main": "server/dist/worker.js",
  "compatibility_date": "2026-11-01",
  "compatibility_flags": ["nodejs_compat"],
  "assets": {
    "directory": "client/dist",
    "not_found_handling": "single-page-application",
    "run_worker_first": ["/api/*"],
  },
  "d1_databases": [
    { "binding": "DB", "database_name": "app", "migrations_dir": "server/migrations" },
  ],
  "vars": { "NODE_ENV": "production", "GREETING": "hello" },
}`;
const MIGRATIONS = {
  "0001_collections.sql":
    "CREATE TABLE collections (name TEXT PRIMARY KEY, value TEXT NOT NULL, version INTEGER NOT NULL);\n",
  "0002_orders.sql": "CREATE TABLE orders (id INTEGER PRIMARY KEY);",
};
const WORKER = "export default { fetch() { return new Response('hi'); } };";

// The challenge Cloudflare hands out, and the proof of it worked out with Web Crypto, apart from
// the solver.
const SEED = new Uint8Array(32).map((_, index) => 255 - index);
const WORK = { k: 4, g: 3 };
async function proofOf(seed: Uint8Array, k: number, g: number) {
  const digest = async (bytes: Uint8Array) =>
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new Uint8Array(bytes)),
    );
  let current = await digest(seed);
  const out = [current];
  for (let at = 0; at < k; at++) {
    for (let round = 0; round < g; round++) current = await digest(current);
    out.push(current);
  }
  return Buffer.concat(out).toString("base64");
}

type Call = {
  via: "key" | "plain";
  method: string;
  path: string;
  auth: string | null;
  body: unknown;
};
type Refusal = { status: number; codes: number[] };

// Cloudflare's API as the spike recorded its answers, holding the accounts, scripts and databases a
// test starts with, and refusing the calls a test names.
function cloudflare(options: {
  accounts?: string[];
  subdomains?: Record<string, string | undefined>;
  scripts?: Record<string, string[]>;
  applied?: Record<string, string[]>;
  refuse?: Record<string, Refusal>;
  // The saved key's status where Cloudflare verifies it; an expired key is refused everywhere else.
  key?: "active" | "expired";
  // Cloudflare's deadline for a new temporary account, as it writes it.
  expiresAt?: string;
}) {
  const calls: Call[] = [];
  const subdomains: Record<string, string | undefined> = {
    "acc-own": "person",
    ...options.subdomains,
  };
  const scripts = structuredClone(options.scripts ?? {});
  const applied: Record<string, string[]> = structuredClone(
    options.applied ?? {},
  );
  const uploaded: { account: string; script: string; metadata: unknown }[] = [];
  const sql: string[] = [];
  let created = 0;
  const envelope = (result: unknown, status = 200) =>
    Response.json(
      { success: true, errors: [], messages: [], result },
      { status },
    );
  const refused = ({ status, codes }: Refusal) =>
    Response.json(
      {
        success: false,
        errors: codes.map((code) => ({ code, message: RAW })),
        result: null,
      },
      { status },
    );
  // The refusals a test names, and the saved key as the spike found a token made under the account:
  // the profile's route refuses it whether it works or not, the account's own route answers with its
  // status, expired included, and an expired one is refused everywhere else.
  const refusedOrVerified = (via: Call["via"], route: string) => {
    const refusal = Object.entries(options.refuse ?? {}).find(([pattern]) =>
      new RegExp(`^${pattern}$`).test(route),
    )?.[1];
    if (refusal) return refused(refusal);
    if (route === "GET /user/tokens/verify")
      return refused({ status: 401, codes: [1000] });
    if (/^GET \/accounts\/[^/]+\/tokens\/verify$/.test(route))
      return envelope({ id: "t", status: options.key ?? "active" });
    if (via === "key" && options.key === "expired")
      return route === "GET /accounts"
        ? refused({ status: 401, codes: [10000] })
        : refused({ status: 403, codes: [9109] });
    return undefined;
  };
  const answer = async (via: Call["via"], url: string, init: RequestInit) => {
    const path = url.slice(API.length);
    const method = init.method ?? "GET";
    const auth = new Headers(init.headers).get("authorization");
    let body: unknown = init.body;
    if (typeof init.body === "string") body = JSON.parse(init.body);
    calls.push({ via, method, path, auth, body });
    const route = `${method} ${path.replace(/\?.*$/, "")}`;
    const ruled = refusedOrVerified(via, route);
    if (ruled) return ruled;
    let match: RegExpExecArray | null;
    if (route === "POST /provisioning/previews/challenge")
      return envelope({
        challengeToken: "challenge-1",
        seed: Buffer.from(SEED).toString("base64url"),
        ...WORK,
        s: 16,
        expiresAt: Math.floor(START.getTime() / 1000) + 120,
      });
    if (route === "POST /provisioning/previews") {
      const given = body as {
        acceptTermsOfService: string;
        solution: { checkpoints: string };
      };
      if (
        given.acceptTermsOfService !== "yes" ||
        given.solution.checkpoints !== (await proofOf(SEED, WORK.k, WORK.g))
      )
        return refused({ status: 400, codes: [1001] });
      created++;
      subdomains["acc-temp"] = "bolder-advantage";
      const expiresAt =
        options.expiresAt ??
        new Date(START.getTime() + 60 * 60_000).toISOString();
      return envelope(
        {
          account: {
            id: "acc-temp",
            name: "Bolder Advantage",
            type: "standard",
            apiToken: TEMP_TOKEN,
            tokenId: "t1",
            expiresAt,
          },
          claim: { token: "claim-token", url: CLAIM_URL, expiresAt },
        },
        201,
      );
    }
    if (route === "GET /accounts")
      return envelope((options.accounts ?? []).map((id) => ({ id, name: id })));
    if ((match = /^GET \/accounts\/([^/]+)\/workers\/subdomain$/.exec(route))) {
      const subdomain = subdomains[match[1] ?? ""];
      return subdomain === undefined
        ? refused({ status: 404, codes: [10007] })
        : envelope({ subdomain });
    }
    if ((match = /^GET \/accounts\/([^/]+)\/workers\/scripts$/.exec(route)))
      return envelope((scripts[match[1] ?? ""] ?? []).map((id) => ({ id })));
    if (/^GET \/accounts\/[^/]+\/d1\/database$/.test(route))
      return envelope([]);
    if ((match = /^POST \/accounts\/([^/]+)\/d1\/database$/.exec(route))) {
      const uuid = `db-${match[1]}`;
      applied[uuid] = [];
      return envelope({ uuid, name: (body as { name: string }).name });
    }
    if (
      (match = /^POST \/accounts\/[^/]+\/d1\/database\/([^/]+)\/query$/.exec(
        route,
      ))
    ) {
      const database = match[1] ?? "";
      const { sql: text } = body as { sql: string };
      sql.push(text);
      if (text.startsWith("SELECT name FROM d1_migrations"))
        return envelope([
          {
            results: (applied[database] ?? []).map((name) => ({ name })),
            success: true,
            meta: {},
          },
        ]);
      const recorded =
        /INSERT INTO d1_migrations \(name\) VALUES \('([^']+)'\);$/.exec(text);
      if (recorded?.[1]) (applied[database] ??= []).push(recorded[1]);
      return envelope([{ results: [], success: true, meta: {} }]);
    }
    if (
      /^POST \/accounts\/[^/]+\/workers\/scripts\/[^/]+\/assets-upload-session$/.test(
        route,
      )
    ) {
      const manifest = (body as { manifest: Record<string, { hash: string }> })
        .manifest;
      return envelope({
        jwt: SESSION_JWT,
        buckets: [Object.values(manifest).map(({ hash }) => hash)],
      });
    }
    if (/^POST \/accounts\/[^/]+\/workers\/assets\/upload$/.test(route))
      return auth === `Bearer ${SESSION_JWT}`
        ? envelope({ jwt: COMPLETION_JWT }, 201)
        : refused({ status: 401, codes: [10000] });
    if (
      (match = /^PUT \/accounts\/([^/]+)\/workers\/scripts\/([^/]+)$/.exec(
        route,
      ))
    ) {
      const form = init.body as FormData;
      const metadata = JSON.parse(await (form.get("metadata") as Blob).text());
      uploaded.push({
        account: match[1] ?? "",
        script: match[2] ?? "",
        metadata,
      });
      (scripts[match[1] ?? ""] ??= []).push(match[2] ?? "");
      return envelope({ id: match[2] });
    }
    if (
      /^POST \/accounts\/[^/]+\/workers\/scripts\/[^/]+\/subdomain$/.test(route)
    )
      return envelope({ enabled: true, previews_enabled: false });
    if (/^DELETE \/accounts\/[^/]+\/workers\/scripts\/[^/]+$/.test(route))
      return envelope(null);
    return refused({ status: 404, codes: [7003] });
  };
  return {
    calls,
    uploaded,
    sql,
    applied,
    created: () => created,
    plain: (url: string, init: RequestInit) => answer("plain", url, init),
    // The saved key's fetch, which adds the key itself.
    key: (url: string, init: RequestInit) => {
      const headers = new Headers(init.headers);
      headers.set("authorization", "Bearer SAVED-KEY");
      return answer("key", url, { ...init, headers });
    },
  };
}

// Files as the hub's run client hands them back, by their paths from the app's root.
const filesOf = (files: Record<string, string>) =>
  new Map(
    Object.entries(files).map(([path, data]) => [
      path,
      new TextEncoder().encode(data),
    ]),
  );

const SOURCE = {
  "wrangler.jsonc": WRANGLER,
  "package.json": "{}",
  ...Object.fromEntries(
    Object.entries(MIGRATIONS).map(([name, sql]) => [
      `server/migrations/${name}`,
      sql,
    ]),
  ),
};
const BUILT = {
  "server/dist/worker.js": WORKER,
  "client/dist/index.html": "<!doctype html><title>App</title>",
  "client/dist/assets/app.js": "console.log('app')",
  "client/dist/assets/app.js.map": '{"sources":["../src/app.ts"]}',
};

// A project's hub: its values, its saved app and what a build of it makes; and what was recorded.
function hub(options: {
  values?: Record<string, unknown>;
  source?: Record<string, string> | undefined;
  built?: Record<string, string>;
  builtVersion?: string;
  refuse?: AppBuildRefusal;
  // Which attempts to save values, counted from 0, the hub fails.
  failSaves?: number[];
}) {
  const values: Record<string, unknown> = {
    "stack.production": PRODUCTION,
    ...options.values,
  };
  const recorded: Record<string, unknown>[] = [];
  const built: string[][] = [];
  let attempts = 0;
  return {
    recorded,
    built,
    values,
    hub: {
      projectId: async () => "project-1",
      values: async (names: readonly string[]) =>
        Object.fromEntries(names.map((name) => [name, values[name] ?? null])),
      source: async () =>
        options.source === undefined && "source" in options
          ? undefined
          : {
              version: VERSION,
              files: filesOf(options.source ?? SOURCE),
            },
      build: async (paths: readonly string[]) => {
        built.push([...paths]);
        if (options.refuse) return { refused: options.refuse };
        return {
          version: options.builtVersion ?? VERSION,
          files: filesOf(options.built ?? BUILT),
        };
      },
      record: async (saved: Readonly<Record<string, unknown>>) => {
        if (options.failSaves?.includes(attempts++))
          throw new BuilderUnavailable();
        recorded.push({ ...saved });
        Object.assign(values, saved);
      },
      serverKey: async () => {
        throw new Error("Cloudflare never asks the hub for a server key");
      },
      heldServerKey: async () => {
        throw new Error("Cloudflare never asks the hub for a server key");
      },
      bindServerKey: async () => {
        throw new Error("Cloudflare never asks the hub for a server key");
      },
      revokeServerKey: async () => {
        throw new Error("Cloudflare never asks the hub for a server key");
      },
    },
  };
}

type Setup = {
  cf: ReturnType<typeof cloudflare>;
  project: ReturnType<typeof hub>;
  keyed?: boolean;
  visits?: (number | undefined)[];
};

// Runs a tool, and holds that nothing it answers carries a secret or Cloudflare's own words.
async function run(tool: (deps: Deps) => Promise<Outcome>, setup: Setup) {
  let now = START.getTime();
  const visits = [...(setup.visits ?? [200])];
  const visited: string[] = [];
  // What the project held when the address was first visited.
  let held: Record<string, unknown> | undefined;
  const outcome = await tool({
    hub: setup.project.hub,
    key: async () => (setup.keyed ? setup.cf.key : undefined),
    fetch: setup.cf.plain,
    visit: async (url) => {
      held ??= { ...setup.project.values };
      visited.push(url);
      return visits.length > 1 ? visits.shift() : visits[0];
    },
    sleep: async (ms) => {
      now += ms;
    },
    now: () => new Date(now),
    signal: new AbortController().signal,
  });
  const said = JSON.stringify(outcome);
  for (const secret of SECRETS) expect(said).not.toContain(secret);
  return { outcome, visited, held, waitedMs: now - START.getTime() };
}

// Cloudflare refusing a new temporary account's token, as it does for a few seconds after making
// it, on the calls to the route given, the first `times` times.
function refusingNewToken(
  cf: ReturnType<typeof cloudflare>,
  route: RegExp,
  times: number,
) {
  let refused = 0;
  const plain = async (url: string, init: RequestInit) => {
    const sent = `${init.method ?? "GET"} ${url.slice(API.length)}`;
    if (
      route.test(sent) &&
      new Headers(init.headers).get("authorization") ===
        `Bearer ${TEMP_TOKEN}` &&
      refused < times
    ) {
      refused++;
      return Response.json(
        { success: false, errors: [{ code: 10000, message: RAW }] },
        { status: 401 },
      );
    }
    return cf.plain(url, init);
  };
  return { cf: { ...cf, plain }, refused: () => refused };
}

const TERMS = { "cloudflare.terms": "2026-11-18T09:59:00.000Z" };
const OWN_SITE = {
  account: "acc-own",
  script: "app",
  database: "db-acc-own",
  temporary: false,
};

test("without an account, a release makes one temporary account, publishes there and records the link to keep it", async () => {
  const cf = cloudflare({});
  const project = hub({ values: TERMS });
  const { outcome, visited } = await run(release, { cf, project });
  expect(outcome).toEqual({
    ok: true,
    url: "https://app.bolder-advantage.workers.dev/",
    keepWithinMinutes: 60,
  });
  expect(visited).toEqual(["https://app.bolder-advantage.workers.dev/"]);
  expect(cf.created()).toBe(1);
  // Built from the paths wrangler.jsonc names, nothing else.
  expect(project.built).toEqual([["server/dist/worker.js", "client/dist"]]);
  // Every call to the account carries its token, the upload its session's alone.
  const after = cf.calls.filter(({ path }) =>
    path.startsWith("/accounts/acc-temp/"),
  );
  expect(after).not.toEqual([]);
  for (const call of after)
    expect(call.auth).toBe(
      call.path.includes("/assets/upload")
        ? `Bearer ${SESSION_JWT}`
        : `Bearer ${TEMP_TOKEN}`,
    );
  expect(cf.calls.every((call) => call.via === "plain")).toBe(true);
  expect(cf.applied["db-acc-temp"]).toEqual([
    "0001_collections.sql",
    "0002_orders.sql",
  ]);
  expect(cf.uploaded).toEqual([
    {
      account: "acc-temp",
      script: "app",
      metadata: {
        main_module: "worker.js",
        compatibility_date: "2026-11-01",
        compatibility_flags: ["nodejs_compat"],
        bindings: [
          { type: "plain_text", name: "GREETING", text: "hello" },
          { type: "plain_text", name: "NODE_ENV", text: "production" },
          { type: "d1", name: "DB", id: "db-acc-temp" },
        ],
        assets: {
          jwt: COMPLETION_JWT,
          config: {
            not_found_handling: "single-page-application",
            run_worker_first: ["/api/*"],
          },
        },
      },
    },
  ]);
  const until = new Date(START.getTime() + 60 * 60_000).toISOString();
  const keep = { link: CLAIM_URL, until, place: "Cloudflare" };
  // Before anything else can fail: the link to keep the account, and the acceptance used up.
  expect(project.recorded[0]).toMatchObject({
    "cloudflare.terms": null,
    "publish.keep": keep,
  });
  expect(project.values["publish.keep"]).toEqual(keep);
  // The account is not the person's yet, so the next publish cannot update this app.
  expect(project.values["publish.release"]).toEqual({
    target: "cloudflare",
    url: "https://app.bolder-advantage.workers.dev/",
    version: VERSION,
    at: START.toISOString(),
    replaceable: false,
  });
});

test("the asset manifest names each built client file by its served path, its hash and size, and never a source map", async () => {
  const cf = cloudflare({});
  await run(release, { cf, project: hub({ values: TERMS }) });
  const session = cf.calls.find(({ path }) =>
    path.endsWith("/assets-upload-session"),
  );
  const file = (path: string, data: string) => ({
    hash: assetHash({
      path,
      bytes: new TextEncoder().encode(data),
      contentType: "",
    }),
    size: data.length,
  });
  expect(session?.body).toEqual({
    manifest: {
      "/index.html": file("/index.html", BUILT["client/dist/index.html"]),
      "/assets/app.js": file(
        "/assets/app.js",
        BUILT["client/dist/assets/app.js"],
      ),
    },
  });
});

test("with the person's key, every call goes through the key's fetch but the upload, which carries only its session token, and nothing is left to keep", async () => {
  const cf = cloudflare({ accounts: ["acc-own"] });
  const project = hub({
    values: {
      ...TERMS,
      "publish.keep": {
        link: CLAIM_URL,
        until: START.toISOString(),
        place: "Cloudflare",
      },
    },
  });
  const { outcome } = await run(release, { cf, project, keyed: true });
  expect(outcome).toEqual({ ok: true, url: "https://app.person.workers.dev/" });
  expect(cf.created()).toBe(0);
  for (const call of cf.calls)
    if (call.path.includes("/assets/upload")) {
      expect(call.via).toBe("plain");
      expect(call.auth).toBe(`Bearer ${SESSION_JWT}`);
    } else expect(call.via).toBe("key");
  expect(project.values["cloudflare.site"]).toEqual(OWN_SITE);
  // Publishing with their own key settles the account, so an earlier acceptance no longer stands.
  expect(project.recorded.at(-1)).toEqual({
    "cloudflare.site": OWN_SITE,
    "publish.release": {
      target: "cloudflare",
      url: "https://app.person.workers.dev/",
      version: VERSION,
      at: START.toISOString(),
    },
    "publish.keep": null,
    "cloudflare.terms": null,
  });
});

test("a second release updates the same worker and database and applies only the new migrations", async () => {
  const cf = cloudflare({
    accounts: ["acc-own", "acc-other"],
    scripts: { "acc-own": ["app"] },
    applied: { "db-acc-own": ["0001_collections.sql"] },
  });
  const project = hub({ values: { "cloudflare.site": OWN_SITE } });
  const { outcome } = await run(release, { cf, project, keyed: true });
  expect(outcome).toEqual({ ok: true, url: "https://app.person.workers.dev/" });
  const routes = cf.calls.map(({ method, path }) => `${method} ${path}`);
  expect(routes.some((route) => route.endsWith("/d1/database"))).toBe(false);
  expect(cf.applied["db-acc-own"]).toEqual([
    "0001_collections.sql",
    "0002_orders.sql",
  ]);
  expect(
    cf.sql.filter((text) => text.includes("CREATE TABLE collections")),
  ).toEqual([]);
  expect(
    cf.uploaded.map(({ account, script }) => `${account}/${script}`),
  ).toEqual(["acc-own/app"]);
});

test("a migration that fails stops the release before the worker is uploaded, leaving the temporary account the person can keep or let lapse", async () => {
  const failing = cloudflare({});
  const original = failing.plain;
  // Only the second migration's own request is refused.
  const refusing = async (url: string, init: RequestInit) =>
    typeof init.body === "string" && init.body.includes("CREATE TABLE orders")
      ? Response.json(
          { success: false, errors: [{ code: 7500, message: RAW }] },
          { status: 400 },
        )
      : original(url, init);
  const second = hub({ values: TERMS });
  const { outcome: stopped } = await run(release, {
    cf: { ...failing, plain: refusing },
    project: second,
  });
  expect(stopped).toEqual({
    ok: false,
    code: "migration_failed",
    migration: "0002_orders.sql",
    emptyTemporaryAccount: "keepable",
  });
  expect(failing.uploaded).toEqual([]);
  expect(failing.created()).toBe(1);
  expect(second.values["cloudflare.terms"]).toBeNull();
  expect(second.values["publish.keep"]).toEqual(
    expect.objectContaining({ link: CLAIM_URL, place: "Cloudflare" }),
  );
  expect(second.recorded.flatMap(Object.keys)).not.toContain("publish.release");
});

test("a new temporary account's token refused for its first seconds is waited for, and the release goes on", async () => {
  const { cf, refused } = refusingNewToken(
    cloudflare({}),
    /^(POST \/accounts\/[^/]+\/d1\/database|PUT \/accounts\/[^/]+\/workers\/scripts\/app)$/,
    4,
  );
  const project = hub({ values: TERMS });
  const { outcome } = await run(release, { cf, project });
  expect(outcome).toMatchObject({
    ok: true,
    url: "https://app.bolder-advantage.workers.dev/",
  });
  expect(refused()).toBeGreaterThan(0);
  expect(cf.created()).toBe(1);
  expect(cf.applied["db-acc-temp"]).toEqual([
    "0001_collections.sql",
    "0002_orders.sql",
  ]);
  expect(cf.uploaded.map(({ script }) => script)).toEqual(["app"]);
});

test("saving the link to keep a new account is asked again once, and the account is out of reach only when both fail", async () => {
  const retried = hub({ values: TERMS, failSaves: [0] });
  const { outcome } = await run(release, {
    cf: cloudflare({}),
    project: retried,
  });
  expect(outcome).toEqual(expect.objectContaining({ ok: true }));
  expect(retried.values["publish.keep"]).toEqual(
    expect.objectContaining({ link: CLAIM_URL, place: "Cloudflare" }),
  );

  const cf = cloudflare({});
  const failed = hub({ values: TERMS, failSaves: [0, 1] });
  const { outcome: lost } = await run(release, { cf, project: failed });
  expect(lost).toEqual({
    ok: false,
    code: "builder_unavailable",
    emptyTemporaryAccount: "unreachable",
  });
  expect(cf.created()).toBe(1);
  expect(cf.uploaded).toEqual([]);
});

test("each way a publish cannot start is its own code, with nothing created", async () => {
  const cases: [Setup, Outcome][] = [
    [
      { cf: cloudflare({}), project: hub({}) },
      { ok: false, code: "no_account_chosen" },
    ],
    [
      {
        cf: cloudflare({ accounts: ["a", "b"] }),
        project: hub({}),
        keyed: true,
      },
      { ok: false, code: "several_accounts" },
    ],
    [
      {
        cf: cloudflare({
          accounts: ["acc-own"],
          scripts: { "acc-own": ["app"] },
        }),
        project: hub({}),
        keyed: true,
      },
      { ok: false, code: "name_taken" },
    ],
  ];
  for (const [setup, expected] of cases) {
    expect((await run(release, setup)).outcome).toEqual(expected);
    expect(setup.cf.created()).toBe(0);
    expect(setup.cf.uploaded).toEqual([]);
  }
});

test("an address slow to answer is published but not answering yet", async () => {
  const project = hub({ values: TERMS });
  const { outcome } = await run(release, {
    cf: cloudflare({}),
    project,
    visits: [404],
  });
  expect(outcome).toEqual({
    ok: false,
    code: "not_answering_yet",
    url: "https://app.bolder-advantage.workers.dev/",
    keepWithinMinutes: 60,
  });
  expect(project.values["publish.keep"]).toEqual(
    expect.objectContaining({ link: CLAIM_URL, place: "Cloudflare" }),
  );
  expect(project.values["publish.release"]).toEqual(
    expect.objectContaining({
      url: "https://app.bolder-advantage.workers.dev/",
      version: VERSION,
    }),
  );
});

test("an acceptance of Cloudflare's terms older than an hour does not make an account, and is cleared so the person is asked again", async () => {
  const cf = cloudflare({});
  const project = hub({
    values: { "cloudflare.terms": "2026-11-18T08:59:00.000Z" },
  });
  const { outcome } = await run(release, { cf, project });
  expect(outcome).toEqual({ ok: false, code: "no_account_chosen" });
  expect(cf.calls).toEqual([]);
  expect(project.recorded).toEqual([{ "cloudflare.terms": null }]);
});

// A release on Cloudflare, and the person's go-ahead on the take-down screen to take it down.
const takenDown = {
  "cloudflare.site": OWN_SITE,
  "publish.release": {
    target: "cloudflare",
    url: "https://app.person.workers.dev/",
    version: VERSION,
    at: START.toISOString(),
  },
  "publish.take-down": { target: "cloudflare", release: START.toISOString() },
};

test("taking the app down with the person's own key deletes only the worker and clears what was published", async () => {
  const cf = cloudflare({ accounts: ["acc-own"] });
  const project = hub({ values: takenDown });
  expect((await run(unpublish, { cf, project, keyed: true })).outcome).toEqual({
    ok: true,
    databaseKept: true,
  });
  expect(
    cf.calls
      .filter(({ method }) => method === "DELETE")
      .map(({ path }) => path),
  ).toEqual(["/accounts/acc-own/workers/scripts/app"]);
  expect(project.recorded).toEqual([
    { "publish.release": null, "publish.keep": null },
  ]);
});

test("taking the app down without the person's go-ahead for what is published now does nothing", async () => {
  for (const answer of [
    null,
    { target: "server", release: START.toISOString() },
    { target: "cloudflare", release: "2026-11-18T08:00:00.000Z" },
  ]) {
    const cf = cloudflare({ accounts: ["acc-own"] });
    const project = hub({
      values: { ...takenDown, "publish.take-down": answer },
    });
    expect(
      (await run(unpublish, { cf, project, keyed: true })).outcome,
    ).toEqual({ ok: false, code: "not_agreed" });
    expect(cf.calls).toEqual([]);
    expect(project.recorded).toEqual([]);
  }
});
