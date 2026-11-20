import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { createHash } from "node:crypto";
import { WorkflowHttpError } from "@corbits-builder/plugin/http-json";
import {
  BuilderUnavailable,
  type RunHub,
} from "@corbits-builder/plugin/run-hub";
import type {
  ServerKeyBind,
  ServerKeyRefusalCode,
  ServerKeyState,
} from "@corbits-builder/schemas/settings";
import { digitalOcean, type Client } from "./api.ts";
import { makeHostKey } from "./host-key.ts";
import { IMAGE } from "./target.ts";
import { createServer, removeServer, type Deps } from "./provision.ts";

const LABEL = "builder-a1b2c3d4e5f6";
const LOGIN_KEY =
  "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIBuilderLoginKey builder";
const TEAM = { id: "team-1", name: "Bakery" };
const AGREED_AT = "2026-11-18T09:00:00.000Z";
const CHOICE = {
  size: "s-1vcpu-1gb",
  region: "fra1",
  monthly: 6,
  team: TEAM,
  at: AGREED_AT,
};
const ADDRESS = "203.0.113.7";

// The SHA256 fingerprint of an OpenSSH public key line, as `ssh-keygen -l` writes it.
const fingerprintOf = (publicKey: string) =>
  `SHA256:${createHash("sha256")
    .update(Buffer.from(publicKey.split(" ")[1] ?? "", "base64"))
    .digest("base64")
    .replace(/=+$/, "")}`;

type Event = { at: number; what: string; detail?: unknown };

type Droplet = {
  id: number;
  name: string;
  created: number;
  deleted?: number;
  // Whether this test's server takes Builder's key once it is up.
  takesKey: boolean;
};

// DigitalOcean's API as the spike of 2026-11-18 recorded its answers, in time the test's clock
// keeps: a server is active with an address 40 s after it is asked for and takes a key 140 s after
// it; a deleted one stays readable by id for gone.after, 20 s unless a test says otherwise; a listing
// lags a create or delete by listLag; and each call takes callMs to answer.
function digitalOceanApi(
  clock: { now(): number; sleep(ms: number): Promise<void> },
  events: Event[],
  options: {
    account?: Record<string, unknown>;
    prices?: Record<string, number>;
    droplets?: Omit<Droplet, "created">[];
    listLag?: number;
    keyTakenAfter?: number;
    // What the create answers instead of 202, after it made the server or not.
    // Answered to the first create only; any after it is made as DigitalOcean makes it.
    create?: { status: number; body?: unknown; made: boolean } | "timeout";
    signedOut?: boolean;
    // How many listings of the account's keys fail before they answer.
    keyListFails?: number;
    callMs?: number;
  } = {},
) {
  const droplets: Droplet[] = (options.droplets ?? []).map((droplet) => ({
    ...droplet,
    created: -1_000_000,
  }));
  const keys: { id: number; name: string; public_key: string }[] = [];
  const listLag = options.listLag ?? 0;
  const gone = { after: 20_000 };
  const takesAfter = options.keyTakenAfter ?? 140_000;
  let createAnswer = options.create;
  let keyListFails = options.keyListFails ?? 0;
  let next = 500_000;
  const json = (body: unknown, status = 200) => Response.json(body, { status });
  const shape = (droplet: Droplet) => {
    const up = clock.now() >= droplet.created + 40_000;
    return {
      id: droplet.id,
      name: droplet.name,
      memory: 1024,
      vcpus: 1,
      disk: 25,
      locked: false,
      status: up ? "active" : "new",
      networks: {
        v4: up
          ? [
              {
                ip_address: "10.110.0.2",
                netmask: "255.255.240.0",
                type: "private",
              },
              { ip_address: ADDRESS, netmask: "255.255.240.0", type: "public" },
            ]
          : [],
        v6: [],
      },
      region: { slug: "fra1" },
      tags: [],
    };
  };
  const readable = (droplet: Droplet) =>
    droplet.deleted === undefined || clock.now() < droplet.deleted + gone.after;
  const listed = (droplet: Droplet) =>
    clock.now() >= droplet.created + listLag &&
    (droplet.deleted === undefined || clock.now() < droplet.deleted + listLag);
  const fetch = async (path: string, init: RequestInit) => {
    const method = init.method ?? "GET";
    const body =
      typeof init.body === "string" ? JSON.parse(init.body) : undefined;
    events.push({ at: clock.now(), what: `${method} ${path}`, detail: body });
    await clock.sleep(options.callMs ?? 0);
    if (options.signedOut)
      return json(
        { id: "unauthorized", message: "Unable to authenticate you" },
        401,
      );
    const route = `${method} ${path.replace(/\?.*$/, "")}`;
    let match: RegExpExecArray | null;
    if (route === "GET /v2/account")
      return json({
        account: {
          droplet_limit: 10,
          floating_ip_limit: 3,
          email: "person@example.com",
          uuid: "account-1",
          email_verified: true,
          status: "active",
          status_message: "",
          team: { uuid: TEAM.id, name: TEAM.name },
          ...options.account,
        },
      });
    if (route === "GET /v2/sizes")
      return json({
        sizes: [
          {
            slug: "s-1vcpu-512mb-10gb",
            memory: 512,
            vcpus: 1,
            disk: 10,
            price_monthly: 4,
            price_hourly: 0.00595,
            regions: ["fra1", "lon1"],
            available: true,
          },
          {
            slug: "s-1vcpu-1gb",
            memory: 1024,
            vcpus: 1,
            disk: 25,
            price_monthly: options.prices?.["s-1vcpu-1gb"] ?? 6,
            price_hourly: 0.00893,
            regions: [
              "blr1",
              "fra1",
              "lon1",
              "sfo2",
              "sfo3",
              "sgp1",
              "nyc3",
              "ams3",
            ],
            available: true,
          },
        ],
        meta: { total: 2 },
      });
    if (route === "GET /v2/droplets") {
      const name = new URL(
        path,
        "https://api.digitalocean.com",
      ).searchParams.get("name");
      const found = droplets.filter(
        (each) => each.name === name && listed(each),
      );
      return json({
        droplets: found.map(shape),
        meta: { total: found.length },
      });
    }
    if ((match = /^GET \/v2\/droplets\/(\d+)$/.exec(route))) {
      const droplet = droplets.find((each) => String(each.id) === match![1]);
      if (droplet === undefined || !readable(droplet))
        return json(
          {
            id: "not_found",
            message: "The resource you were accessing could not be found.",
          },
          404,
        );
      return json({ droplet: shape(droplet) });
    }
    if ((match = /^DELETE \/v2\/droplets\/(\d+)$/.exec(route))) {
      const droplet = droplets.find((each) => String(each.id) === match![1]);
      if (droplet === undefined || droplet.deleted !== undefined)
        return json(
          {
            id: "not_found",
            message: "The resource you were accessing could not be found.",
          },
          404,
        );
      droplet.deleted = clock.now();
      return new Response(null, { status: 204 });
    }
    if (route === "POST /v2/account/keys") {
      if (keys.some((key) => key.public_key === body.public_key))
        return json(
          {
            id: "unprocessable_entity",
            message: "SSH Key is already in use on your account",
          },
          422,
        );
      const key = {
        id: next++,
        fingerprint: "aa:bb",
        name: body.name,
        public_key: body.public_key,
      };
      keys.push(key);
      return json({ ssh_key: key }, 201);
    }
    if (route === "GET /v2/account/keys") {
      if (keyListFails-- > 0) return new Response("busy", { status: 503 });
      return json({ ssh_keys: keys, links: {}, meta: { total: keys.length } });
    }
    if ((match = /^DELETE \/v2\/account\/keys\/(\d+)$/.exec(route))) {
      const at = keys.findIndex((key) => String(key.id) === match![1]);
      if (at < 0) return json({ id: "not_found", message: "not found" }, 404);
      keys.splice(at, 1);
      return new Response(null, { status: 204 });
    }
    if (route === "POST /v2/droplets") {
      const make = () => {
        const droplet: Droplet = {
          id: next++,
          name: body.name,
          created: clock.now(),
          takesKey: takesAfter !== Infinity,
        };
        droplets.push(droplet);
        return droplet;
      };
      const answer = createAnswer;
      createAnswer = undefined;
      if (answer === "timeout") {
        make();
        throw new TypeError("The operation timed out.");
      }
      if (answer !== undefined) {
        if (answer.made) make();
        return answer.body === undefined
          ? new Response("upstream failed", { status: answer.status })
          : json(answer.body, answer.status);
      }
      const droplet = make();
      return json(
        {
          droplet: {
            ...shape(droplet),
            status: "new",
            networks: { v4: [], v6: [] },
          },
          links: {
            actions: [
              {
                id: 1,
                rel: "create",
                href: "https://api.digitalocean.com/v2/actions/1",
              },
            ],
          },
        },
        202,
      );
    }
    return json({ id: "not_found", message: "no route" }, 404);
  };
  return {
    fetch,
    droplets,
    keys,
    gone,
    // Whether a server of this address takes Builder's key now.
    takesKey(host: string) {
      return droplets.some(
        (each) =>
          each.deleted === undefined &&
          each.takesKey &&
          host === ADDRESS &&
          clock.now() >= each.created + takesAfter,
      );
    },
  };
}

// The hub as a provisioning run reaches it: the project's values, and the server key it made, which
// is undefined while none was asked for.
function fakeHub(
  clock: { now(): number },
  events: Event[],
  stored: Record<string, unknown>,
  key: ServerKeyState | { refused: ServerKeyRefusalCode } | undefined,
  takesKey: (host: string) => boolean,
  bind: {
    // How many binds the hub does not answer in time before it does.
    unanswered?: number;
    refused?: ServerKeyRefusalCode;
    // The hub refuses the run's own access from the first bind on.
    accessLost?: true;
  } = {},
) {
  const binds: ServerKeyBind[] = [];
  let unanswered = bind.unanswered ?? 0;
  const hub: RunHub = {
    projectId: async () => "project-1",
    values: async (names) =>
      Object.fromEntries(names.map((name) => [name, stored[name] ?? null])),
    record: async (values) => {
      events.push({ at: clock.now(), what: "record", detail: values });
      Object.assign(stored, values);
    },
    source: async () => undefined,
    build: async () => ({ refused: "app_not_filed" }),
    serverKey: async () => {
      key ??= { publicKey: LOGIN_KEY, label: LABEL, state: "issued" };
      return key;
    },
    heldServerKey: async () => key,
    bindServerKey: async (_name, server) => {
      binds.push(server);
      events.push({ at: clock.now(), what: "bind", detail: server });
      if (unanswered-- > 0) throw new BuilderUnavailable();
      if (bind.accessLost)
        throw new BuilderUnavailable({
          cause: new WorkflowHttpError(403, "unspecified", "forbidden"),
        });
      if (bind.refused !== undefined) {
        // A key taken or bound elsewhere is never handed to this plugin again.
        if (
          bind.refused === "server_key_taken" ||
          bind.refused === "server_key_bound_elsewhere"
        )
          key = { refused: bind.refused };
        return { refused: bind.refused };
      }
      if (key === undefined || "refused" in key)
        return { refused: "server_key_not_issued" };
      if (!takesKey(server.host)) return { refused: "server_unreachable" };
      key = { ...key, state: "bound", address: server.host };
      return key;
    },
    revokeServerKey: async () => {
      events.push({ at: clock.now(), what: "revoke" });
      key = undefined;
      return { revoked: true };
    },
  };
  return { hub, binds };
}

const issued: ServerKeyState = {
  publicKey: LOGIN_KEY,
  label: LABEL,
  state: "issued",
};
const bound: ServerKeyState = { ...issued, state: "bound", address: ADDRESS };

// A run's call against DigitalOcean and the hub, with these values stored and this key ("none"
// while none was ever made), every host key it made kept for the test to look for.
function setup(
  stored: Record<string, unknown>,
  options: Parameters<typeof digitalOceanApi>[2] & {
    key?: ServerKeyState | { refused: ServerKeyRefusalCode } | "none";
    bind?: Parameters<typeof fakeHub>[5];
  } = {},
) {
  let now = 0;
  const clock = {
    now: () => now,
    sleep: async (ms: number) => {
      now += ms;
    },
  };
  const events: Event[] = [];
  const api = digitalOceanApi(clock, events, options);
  const { hub, binds } = fakeHub(
    clock,
    events,
    stored,
    options.key === "none" ? undefined : (options.key ?? issued),
    (host) => api.takesKey(host),
    options.bind,
  );
  const capabilities = {
    resolve: () => ({
      resolve: async () => ({ kind: "http", fetch: api.fetch, dispose() {} }),
    }),
  } as unknown as Client["capabilities"];
  const userData: string[] = [];
  const deps: Deps = {
    vendor: digitalOcean({
      capabilities,
      handle: "digitalocean",
      signal: new AbortController().signal,
      sleep: clock.sleep,
    }),
    hub,
    clock,
    now: () => new Date(Date.UTC(2026, 10, 18, 10) + now),
    hostKey: async () => {
      const made = await makeHostKey();
      userData.push(made.userData);
      return made;
    },
    signal: new AbortController().signal,
  };
  return { deps, api, events, stored, binds, userData, clock };
}

const calls = (events: Event[], what: string) =>
  events.filter((event) => event.what.startsWith(what));

// Everything a run hands on, besides the provider's user-data, is said to the console here.
let said: unknown[] = [];
let spies: ReturnType<typeof spyOn>[] = [];
beforeEach(() => {
  said = [];
  spies = (["log", "info", "warn", "error", "debug"] as const).map((level) =>
    spyOn(console, level).mockImplementation((...args: unknown[]) => {
      said.push(args);
    }),
  );
});
afterEach(() => {
  for (const spy of spies) spy.mockRestore();
});

const privateKeyOf = (userData: string) =>
  /-----BEGIN OPENSSH PRIVATE KEY-----[\s\S]*?-----END OPENSSH PRIVATE KEY-----/
    .exec(userData)?.[0]
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => !line.startsWith("-----"))
    .join("");

// A first server made for the agreed choice, as a run sees it end.
async function madeServer() {
  const made = setup({ "digitalocean.choice": CHOICE });
  const outcome = await createServer(made.deps);
  expect(outcome).toEqual({ ok: true, address: ADDRESS, made: true });
  const request = calls(made.events, "POST /v2/droplets")[0]?.detail as Record<
    string,
    unknown
  >;
  return { ...made, outcome, request, data: made.userData[0] ?? "" };
}

test("a server is made at the size agreed only once holding is recorded, with Builder's login key, which is dropped once it is bound", async () => {
  const { events, api, request } = await madeServer();
  const created = events.findIndex(
    (event) => event.what === "POST /v2/droplets",
  );
  const holding = events.findIndex(
    (event) =>
      event.what === "record" &&
      (event.detail as Record<string, unknown>)["publish.holding"] !==
        undefined,
  );
  expect(holding).toBeGreaterThanOrEqual(0);
  expect(holding).toBeLessThan(created);
  expect(events[holding]?.detail).toMatchObject({
    "publish.holding": {
      target: "digitalocean",
      place: "DigitalOcean",
      since: "2026-11-18T10:00:00.000Z",
      costs: "$6 a month",
    },
  });
  expect(calls(events, "POST /v2/droplets")).toHaveLength(1);
  expect(request).toMatchObject({
    name: LABEL,
    region: "fra1",
    size: "s-1vcpu-1gb",
    image: IMAGE,
    monitoring: false,
    backups: false,
    ipv6: false,
  });

  // The login key reached the server through the account's key list, and is gone from it.
  expect(calls(events, "POST /v2/account/keys")[0]?.detail).toEqual({
    name: LABEL,
    public_key: LOGIN_KEY,
  });
  expect(api.keys).toEqual([]);
});

test("the hub binds the server to the host key its user-data carries, asked again until the server takes Builder's key", async () => {
  const { binds, request, data } = await madeServer();
  expect(request["user_data"]).toBe(data);
  expect(data).toContain("ssh_pwauth: false");
  expect(data).toContain("ssh_deletekeys: true");
  const publicLine = /ed25519_public: (.+)/.exec(data)?.[1] ?? "";
  expect(binds.at(-1)).toEqual({
    host: ADDRESS,
    hostKey: fingerprintOf(publicLine),
  });
  expect(binds.length).toBeGreaterThan(1);
});

test("the server's private host key goes to DigitalOcean in the user-data and nowhere else", async () => {
  const { outcome, stored, events, data } = await madeServer();
  const secret = privateKeyOf(data) ?? "";
  expect(secret.length).toBeGreaterThan(100);
  const handed = JSON.stringify([
    outcome,
    stored,
    said,
    events.filter((event) => event.what !== "POST /v2/droplets"),
  ]);
  for (const line of secret.match(/.{1,40}/g) ?? [])
    expect(handed).not.toContain(line);
});

const held = {
  target: "digitalocean",
  place: "DigitalOcean",
  since: AGREED_AT,
  costs: "$6 a month",
};
const boundNote = {
  stage: "bound",
  id: "700",
  address: ADDRESS,
  label: LABEL,
  team: TEAM,
};
const ANOTHER_TEAM = {
  account: { team: { uuid: "team-2", name: "Personal" } },
};
const touched = (events: Event[]) =>
  events.filter(
    (event) =>
      event.what === "revoke" ||
      event.what === "record" ||
      event.what.startsWith("DELETE") ||
      event.what.startsWith("POST"),
  );

test("a server that is up already is reported, and nothing is made", async () => {
  const { deps, events } = setup(
    {
      "digitalocean.choice": CHOICE,
      "digitalocean.server": boundNote,
      "publish.holding": held,
    },
    { key: bound, droplets: [{ id: 700, name: LABEL, takesKey: true }] },
  );
  expect(await createServer(deps)).toEqual({
    ok: true,
    address: ADDRESS,
    made: false,
  });
  expect(touched(events)).toEqual([]);
});

test("a server that is up while nothing is recorded as held gets its cost back", async () => {
  const { deps, stored } = setup(
    { "digitalocean.choice": CHOICE, "digitalocean.server": boundNote },
    { key: bound, droplets: [{ id: 700, name: LABEL, takesKey: true }] },
  );
  expect(await createServer(deps)).toMatchObject({ ok: true, made: false });
  expect(stored["publish.holding"]).toEqual({
    target: "digitalocean",
    place: "DigitalOcean",
    since: "2026-11-18T10:00:00.000Z",
    costs: "$6 a month",
  });
});

test("an up server is never taken as gone while the sign-in is for another team", async () => {
  const { deps, events } = setup(
    { "digitalocean.choice": CHOICE, "digitalocean.server": boundNote },
    { key: bound, ...ANOTHER_TEAM },
  );
  expect(await createServer(deps)).toEqual({
    ok: false,
    code: "team_changed",
    team: "Personal",
    agreed: "Bakery",
  });
  expect(touched(events)).toEqual([]);
});

test("a price that moved either way makes nothing and is recorded for the screen", async () => {
  for (const monthly of [7, 5]) {
    const { deps, events, stored } = setup(
      { "digitalocean.choice": CHOICE },
      { prices: { "s-1vcpu-1gb": monthly } },
    );
    expect(await createServer(deps)).toEqual({
      ok: false,
      code: "price_changed",
      monthly,
      agreed: 6,
    });
    expect(stored["digitalocean.quote"]).toEqual({
      size: "s-1vcpu-1gb",
      monthly,
    });
    expect(calls(events, "POST")).toEqual([]);
    expect(stored["publish.holding"]).toBeUndefined();
  }
});

test("a sign-in for another team than the one agreed makes nothing", async () => {
  const { deps, events } = setup(
    { "digitalocean.choice": CHOICE },
    { account: { team: { uuid: "team-2", name: "Personal" } } },
  );
  expect(await createServer(deps)).toMatchObject({
    ok: false,
    code: "team_changed",
  });
  expect(calls(events, "POST")).toEqual([]);
});

test("a server made under a failing answer is waited for while the listing lags", async () => {
  const { deps, events } = setup(
    { "digitalocean.choice": CHOICE },
    { create: { status: 503, made: true }, listLag: 45_000 },
  );
  expect(await createServer(deps)).toMatchObject({ ok: true, made: true });
  expect(calls(events, "POST /v2/droplets")).toHaveLength(1);
  expect(calls(events, "GET /v2/droplets?name=").length).toBeGreaterThan(1);
});

test("a failing create keeps what it holds, and the next call clears it only after looking out the listing's lag", async () => {
  const { deps, events, stored, clock } = setup(
    { "digitalocean.choice": CHOICE },
    { create: { status: 500, made: false } },
  );
  expect(await createServer(deps)).toEqual({
    ok: false,
    code: "provider_unavailable",
  });
  expect(calls(events, "POST /v2/droplets")).toHaveLength(1);
  expect(stored["publish.holding"]).toMatchObject({ target: "digitalocean" });

  const again = clock.now();
  expect(await createServer(deps)).toMatchObject({ ok: true, made: true });
  const cleared = events.findIndex(
    (event) =>
      event.at >= again &&
      event.what === "record" &&
      (event.detail as Record<string, unknown>)["publish.holding"] === null,
  );
  const looked = events
    .slice(0, cleared)
    .filter(
      (event) =>
        event.at >= again && event.what.startsWith("GET /v2/droplets?name="),
    );
  expect(looked.at(-1)?.at).toBeGreaterThanOrEqual(again + 90_000);
  expect(calls(events, "POST /v2/droplets")).toHaveLength(2);
});

test("a server that does not come up in time is destroyed, and holding cleared once it is gone", async () => {
  const { deps, api, events, stored } = setup(
    { "digitalocean.choice": CHOICE },
    { keyTakenAfter: Infinity },
  );
  expect(await createServer(deps)).toEqual({ ok: false, code: "server_slow" });
  const [droplet] = api.droplets;
  expect(calls(events, "DELETE /v2/droplets/")).toEqual([
    expect.objectContaining({
      what: `DELETE /v2/droplets/${String(droplet?.id)}`,
    }),
  ]);
  // Holding is cleared only after DigitalOcean no longer knows the server's id.
  const gone = events.findIndex(
    (event) =>
      event.what === `GET /v2/droplets/${String(droplet?.id)}` &&
      event.at >= (droplet?.deleted ?? 0) + 20_000,
  );
  const cleared = events.findIndex(
    (event) =>
      event.what === "record" &&
      (event.detail as Record<string, unknown>)["publish.holding"] === null,
  );
  expect(gone).toBeGreaterThan(0);
  expect(cleared).toBeGreaterThan(gone);
  expect(stored["publish.holding"]).toBeNull();
  expect(api.keys).toEqual([]);

  // Each server made for the choice counts, so a fourth for it is never made.
  expect(await createServer(deps)).toEqual({ ok: false, code: "server_slow" });
  expect(await createServer(deps)).toEqual({ ok: false, code: "server_slow" });
  expect(await createServer(deps)).toEqual({
    ok: false,
    code: "too_many_tries",
  });
  expect(calls(events, "POST /v2/droplets")).toHaveLength(3);
});

test("a server the hub will not bind, its key taken since, is destroyed at once", async () => {
  const { deps, api, events, stored } = setup(
    { "digitalocean.choice": CHOICE },
    { bind: { refused: "server_key_taken" } },
  );
  expect(await createServer(deps)).toEqual({ ok: false, code: "key_taken" });
  expect(api.droplets.map((droplet) => droplet.deleted)).toEqual([
    expect.any(Number),
  ]);
  expect(stored["publish.holding"]).toBeNull();

  // Nothing is left for a later call to look for.
  const seen = events.length;
  expect(await createServer(deps)).toEqual({ ok: false, code: "key_taken" });
  expect(events.slice(seen)).toEqual([]);
});

test("a server the hub will not bind and DigitalOcean is slow to delete stays held, and once it is gone the next create clears what is held before it answers key_taken", async () => {
  const { deps, api, events, stored, clock } = setup(
    { "digitalocean.choice": CHOICE },
    { bind: { refused: "server_key_taken" } },
  );
  api.gone.after = 200_000;
  expect(await createServer(deps)).toEqual({
    ok: false,
    code: "not_removed_yet",
  });
  expect(stored["publish.holding"]).toMatchObject({ target: "digitalocean" });

  await clock.sleep(200_000);
  const again = clock.now();
  expect(await createServer(deps)).toEqual({ ok: false, code: "key_taken" });
  expect(stored["publish.holding"]).toBeNull();
  const after = events.filter((event) => event.at >= again);
  expect(calls(after, `GET /v2/droplets?name=${LABEL}`)).not.toEqual([]);
  expect(calls(after, "DELETE /v2/droplets/")).toEqual([]);
  expect(calls(after, "POST /v2/droplets")).toEqual([]);

  // What was noted of the server is gone with it, so a later call looks for nothing.
  const seen = events.length;
  expect(await createServer(deps)).toEqual({ ok: false, code: "key_taken" });
  expect(events.slice(seen)).toEqual([]);
});

test("an unbound server an earlier run left is destroyed and made again", async () => {
  const { deps, api, events } = setup(
    {
      "digitalocean.choice": CHOICE,
      "digitalocean.server": {
        stage: "creating",
        attempts: 1,
        for: AGREED_AT,
        team: TEAM,
      },
      "publish.holding": held,
    },
    { droplets: [{ id: 900, name: LABEL, takesKey: true }] },
  );
  expect(await createServer(deps)).toMatchObject({ ok: true, made: true });
  expect(calls(events, "DELETE /v2/droplets/900")).toHaveLength(1);
  const deleted = events.findIndex(
    (event) => event.what === "DELETE /v2/droplets/900",
  );
  const created = events.findIndex(
    (event) => event.what === "POST /v2/droplets",
  );
  expect(created).toBeGreaterThan(deleted);
  expect(calls(events, "POST /v2/droplets")).toHaveLength(1);
  expect(
    api.droplets.filter((each) => each.deleted === undefined),
  ).toHaveLength(1);
});

test("a bound server that is gone while it is still held and published is forgotten once, and never made again until the person chooses again", async () => {
  const { deps, api, events, stored } = setup(
    {
      "digitalocean.choice": CHOICE,
      "digitalocean.server": boundNote,
      "publish.holding": held,
      "publish.release": release,
    },
    { key: bound },
  );
  api.keys.push({ id: 1, name: LABEL, public_key: LOGIN_KEY });
  expect(await createServer(deps)).toEqual({ ok: false, code: "server_gone" });
  const made = () =>
    events.filter(
      (event) =>
        event.what.startsWith("POST") ||
        event.what.startsWith("DELETE /v2/droplets"),
    );
  expect(made()).toEqual([]);
  expect(calls(events, "revoke")).toHaveLength(1);
  expect(stored).toMatchObject({
    "digitalocean.choice": null,
    "publish.holding": null,
    "publish.release": null,
  });
  // Builder's login key is dropped from the account's key list with it.
  expect(api.keys).toEqual([]);
  // The next server is the person's to choose, at the price they agree to then.
  expect(await createServer(deps)).toEqual({ ok: false, code: "no_choice" });
  expect(made()).toEqual([]);
  stored["digitalocean.choice"] = CHOICE;
  expect(await createServer(deps)).toMatchObject({ ok: true, made: true });
  expect(calls(events, "revoke")).toHaveLength(1);
});

const release = {
  target: "digitalocean",
  url: `http://${ADDRESS}/`,
  version: "abc123",
  at: "2026-11-18T09:30:00.000Z",
};
// The person's go-ahead on the take-down screen for this release and this holding.
const agreed = (
  of: { release?: typeof release; held?: typeof held } = { held },
) => ({
  "publish.take-down": {
    target: "digitalocean",
    ...(of.release === undefined ? {} : { release: of.release.at }),
    ...(of.held === undefined ? {} : { holding: of.held.since }),
  },
});

test("a release published elsewhere stays when the server at DigitalOcean is gone", async () => {
  const elsewhere = { ...release, target: "server" };
  const { deps, stored } = setup(
    {
      "digitalocean.choice": CHOICE,
      "digitalocean.server": boundNote,
      "publish.holding": held,
      "publish.release": elsewhere,
    },
    { key: bound },
  );
  expect(await createServer(deps)).toEqual({ ok: false, code: "server_gone" });
  expect(stored["publish.release"]).toEqual(elsewhere);
  expect(stored["publish.holding"]).toBeNull();
});

test("a removal destroys the server, then forgets its key and clears what was recorded, in that order", async () => {
  const { deps, events, stored } = setup(
    {
      "digitalocean.choice": CHOICE,
      "digitalocean.server": boundNote,
      "publish.release": release,
      "publish.holding": held,
      ...agreed({ release, held }),
    },
    { key: bound, droplets: [{ id: 700, name: LABEL, takesKey: true }] },
  );
  expect(await removeServer(deps)).toEqual({ ok: true });
  expect(touched(events).map((event) => event.what)).toEqual([
    "DELETE /v2/droplets/700",
    "revoke",
    "record",
  ]);
  // Gone means DigitalOcean no longer knows its id.
  const gone = events.findIndex(
    (event) => event.what === "GET /v2/droplets/700" && event.at >= 20_000,
  );
  expect(gone).toBeLessThan(
    events.findIndex((event) => event.what === "revoke"),
  );
  // A new server after this needs the person's answer on the account screen again.
  expect(stored).toMatchObject({
    "publish.release": null,
    "publish.holding": null,
    "digitalocean.choice": null,
  });
});

test("a removal whose key was revoked in Settings still destroys the server, then forgets the key and clears what was recorded", async () => {
  const { deps, events, stored } = setup(
    {
      "digitalocean.choice": CHOICE,
      "digitalocean.server": boundNote,
      "publish.release": release,
      "publish.holding": held,
      ...agreed({ release, held }),
    },
    {
      key: { ...bound, state: "lost" },
      droplets: [{ id: 700, name: LABEL, takesKey: true }],
    },
  );
  expect(await removeServer(deps)).toEqual({ ok: true });
  expect(touched(events).map((event) => event.what)).toEqual([
    "DELETE /v2/droplets/700",
    "revoke",
    "record",
  ]);
  expect(stored).toMatchObject({
    "publish.release": null,
    "publish.holding": null,
    "digitalocean.choice": null,
  });
});

test("a removal without the person's go-ahead for what is recorded now does nothing", async () => {
  for (const answer of [
    {},
    { "publish.take-down": { target: "server", holding: AGREED_AT } },
    agreed({ held }),
  ]) {
    const { deps, events } = setup(
      {
        "digitalocean.server": boundNote,
        "publish.release": release,
        "publish.holding": held,
        ...answer,
      },
      { key: bound, droplets: [{ id: 700, name: LABEL, takesKey: true }] },
    );
    expect(await removeServer(deps)).toEqual({
      ok: false,
      code: "not_agreed",
    });
    expect(events).toEqual([]);
  }
});

test("a removal while the sign-in is for another team clears nothing and names both teams", async () => {
  const { deps, events, stored } = setup(
    {
      "digitalocean.choice": CHOICE,
      "digitalocean.server": boundNote,
      "publish.holding": held,
      ...agreed(),
    },
    { key: bound, ...ANOTHER_TEAM },
  );
  expect(await removeServer(deps)).toEqual({
    ok: false,
    code: "team_changed",
    team: "Personal",
    agreed: "Bakery",
  });
  expect(touched(events)).toEqual([]);
  expect(stored["publish.holding"]).toEqual(held);
});

test("a removal whose key the hub refuses destroys the server it recorded, then clears the release and the choice", async () => {
  const { deps, api, stored } = setup(
    {
      "digitalocean.choice": CHOICE,
      "digitalocean.server": boundNote,
      "publish.release": release,
      "publish.holding": held,
      ...agreed({ release, held }),
    },
    {
      key: { refused: "server_key_taken" },
      droplets: [{ id: 700, name: LABEL, takesKey: true }],
    },
  );
  expect(await removeServer(deps)).toEqual({ ok: false, code: "key_taken" });
  expect(api.droplets[0]?.deleted).toBeNumber();
  expect(stored).toMatchObject({
    "publish.release": null,
    "publish.holding": null,
    "digitalocean.choice": null,
  });
});

test("a removal leaves another place's release as it is", async () => {
  const elsewhere = { ...release, target: "cloudflare" };
  const { deps, stored } = setup(
    {
      "digitalocean.server": boundNote,
      "publish.release": elsewhere,
      "publish.holding": held,
      ...agreed(),
    },
    { key: bound, droplets: [{ id: 700, name: LABEL, takesKey: true }] },
  );
  expect(await removeServer(deps)).toEqual({ ok: true });
  expect(stored["publish.release"]).toEqual(elsewhere);
});

test("a removal also destroys a server of the hub's name besides the one recorded", async () => {
  const { deps, events } = setup(
    { "digitalocean.server": boundNote, "publish.holding": held, ...agreed() },
    {
      key: bound,
      droplets: [
        { id: 700, name: LABEL, takesKey: true },
        { id: 701, name: LABEL, takesKey: false },
      ],
    },
  );
  expect(await removeServer(deps)).toEqual({ ok: true });
  expect(
    new Set(calls(events, "DELETE /v2/droplets/").map(({ what }) => what)),
  ).toEqual(new Set(["DELETE /v2/droplets/700", "DELETE /v2/droplets/701"]));
});

test("a server at another address than the one the hub bound is not destroyed", async () => {
  const { deps, events, stored } = setup(
    { "digitalocean.server": boundNote, "publish.holding": held, ...agreed() },
    {
      key: { ...bound, address: "198.51.100.9" },
      droplets: [{ id: 700, name: LABEL, takesKey: true }],
    },
  );
  expect(await removeServer(deps)).toEqual({
    ok: false,
    code: "address_differs",
  });
  expect(touched(events)).toEqual([]);
  expect(stored["publish.holding"]).toEqual(held);
});

test("a removal DigitalOcean refuses the sign-in for clears nothing and names the server", async () => {
  const { deps, events } = setup(
    { "digitalocean.server": boundNote, "publish.holding": held, ...agreed() },
    {
      key: bound,
      signedOut: true,
      droplets: [{ id: 700, name: LABEL, takesKey: true }],
    },
  );
  expect(await removeServer(deps)).toEqual({
    ok: false,
    code: "signed_out",
    server: LABEL,
  });
  expect(touched(events)).toEqual([]);
});

test("with no id recorded, a server is gone only once the listing's lag has passed with none named", async () => {
  const { deps, events, stored } = setup({
    "digitalocean.server": {
      stage: "creating",
      attempts: 1,
      for: AGREED_AT,
      team: TEAM,
    },
    "publish.holding": held,
    ...agreed(),
  });
  expect(await removeServer(deps)).toEqual({ ok: true });
  const looked = calls(events, "GET /v2/droplets?name=");
  expect(looked.length).toBeGreaterThan(1);
  expect(looked.at(-1)?.at).toBeGreaterThanOrEqual(90_000);
  expect(stored["publish.holding"]).toBeNull();
});
