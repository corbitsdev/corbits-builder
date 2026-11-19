import { expect, test } from "bun:test";
import {
  PUBLISH_RELEASE,
  PublishRelease,
} from "@corbits-builder/plugin/publish";
import {
  release,
  status,
  unpublish,
  type Code,
  type Deps,
  type Outcome,
} from "./release.ts";
import { BUN } from "./runtime.ts";
import { serverScript, type ScriptName } from "./scripts.ts";

const PROJECT = "00000000-0000-4000-8000-000000000001";
// The handle of the place a vendor publishes to, which its releases are recorded under.
const TARGET = "vps";
const VERSION = "0123456789abcdef0123456789abcdef01234567";
// Whatever a server prints besides its report must never reach the agent.
const NOISE = "SERVER-PRINTED root:x:0:0 -----BEGIN OPENSSH PRIVATE KEY-----";

const PRODUCTION = {
  install: "bun install --frozen-lockfile",
  build: "bun run build",
  start: "bun run start",
  port: "PORT",
  data: ["server/data"],
};

// A release this target recorded, and the person's go-ahead on the take-down screen to take it down.
const RELEASED = {
  target: TARGET,
  url: "http://203.0.113.7/",
  version: VERSION,
  at: "2026-11-17T09:00:00.000Z",
};
const AGREED = {
  "publish.release": RELEASED,
  "publish.take-down": { target: TARGET, release: RELEASED.at },
};

const PREPARED = {
  os: "debian",
  os_version: "12",
  arch: "x86_64",
  systemd: "yes",
  disk_free_mb: "20000",
  port80: "ours",
  holder: "this",
  bun: "yes",
  unit: "yes",
};

// What each script reports on a server ready for this project, with nothing published on it yet.
const READY: Record<ScriptName, Record<string, string>> = {
  check: { ...PREPARED, code: "ok" },
  prepare: { code: "ok" },
  release: { code: "ok" },
  status: { code: "ok", holder: "this", running: "no", answering: "no" },
  unpublish: { code: "ok" },
};
const SCRIPTS = Object.keys(READY) as ScriptName[];

const report = (fields: Record<string, string>) =>
  [
    NOISE,
    ...Object.entries(fields).map(([key, value]) => `${key}=${value}`),
    NOISE,
  ].join("\n");

type Ran = { script: ScriptName; args: string[]; stdin?: Uint8Array };

// A server that answers each script with the report given for it, or fails as ssh fails.
function setup(
  answers: Partial<Record<ScriptName, Record<string, string> | Error>>,
  values: Record<string, unknown> = { "stack.production": PRODUCTION },
  outside = true,
) {
  const ran: Ran[] = [];
  const recorded: (PublishRelease | null)[] = [];
  const downloads: string[] = [];
  const deps: Deps = {
    server: async () => ({
      address: { host: "203.0.113.7", port: 22 },
      exec: async (argv, options) => {
        const [, , text = "", , ...args] = argv;
        const script = SCRIPTS.find((name) => text === serverScript(name));
        if (script === undefined) throw new Error("unknown script");
        ran.push({
          script,
          args,
          ...(options.stdin === undefined ? {} : { stdin: options.stdin }),
        });
        const answer = answers[script] ?? READY[script];
        if (answer instanceof Error) throw answer;
        return { code: 0, stdout: report(answer), stderr: NOISE };
      },
    }),
    hub: {
      projectId: async () => PROJECT,
      values: async (names) =>
        Object.fromEntries(names.map((name) => [name, values[name] ?? null])),
      source: async () => ({
        version: VERSION,
        files: new Map([
          ["package.json", new TextEncoder().encode("{}")],
          [
            "server/src/index.ts",
            new TextEncoder().encode("export default {}"),
          ],
        ]),
      }),
      build: async () => {
        throw new Error("a server publish never asks the hub to build");
      },
      serverKey: async () => {
        throw new Error("a server publish never asks the hub for a key");
      },
      heldServerKey: async () => {
        throw new Error("a server publish never asks the hub for a key");
      },
      bindServerKey: async () => {
        throw new Error("a server publish never asks the hub for a key");
      },
      revokeServerKey: async () => {
        throw new Error("a server publish never asks the hub for a key");
      },
      record: async (values) => {
        const release = values[PUBLISH_RELEASE];
        recorded.push(release === null ? null : PublishRelease.assert(release));
      },
    },
    answersFromOutside: async () => outside,
    download: async (url) => {
      downloads.push(url);
      return new Uint8Array();
    },
    now: () => new Date("2026-11-17T10:00:00.000Z"),
    signal: new AbortController().signal,
  };
  return { deps, ran, recorded, downloads };
}

const sshFailure = (failure: string) =>
  Object.assign(new Error(`ssh credential: ${failure}`), {
    name: "SshCredentialError",
    failure,
  });

const noRawOutput = (outcome: Outcome) =>
  expect(JSON.stringify(outcome)).not.toContain("SERVER-PRINTED");

// The scripts that change the server ran: it was readied, or a release went on it.
const changed = (ran: readonly Ran[]) =>
  ran.filter(({ script }) => script === "prepare" || script === "release");

test("each way the connection fails is its own code, whichever tool met it", async () => {
  const cases: Record<string, Code> = {
    unreachable: "unreachable",
    auth_failed: "auth_failed",
    host_key_changed: "host_key_changed",
    address_refused: "address_refused",
    timeout: "server_timeout",
    invalid_secret: "key_invalid",
    address_mismatch: "key_invalid",
  };
  for (const [failure, code] of Object.entries(cases))
    for (const tool of [
      (deps: Deps) => release(TARGET, deps),
      status,
      (deps: Deps) => unpublish(TARGET, deps),
    ]) {
      const error = sshFailure(failure);
      const { deps } = setup(
        { check: error, status: error, unpublish: error },
        { "stack.production": PRODUCTION, ...AGREED },
      );
      expect(await tool(deps)).toEqual({ ok: false, code });
    }
});

test("a server that is not Debian or Ubuntu with systemd, holds another app, serves port 80 or is full is refused before anything changes, saying only typed facts", async () => {
  const refused = async (fields: Record<string, string>) => {
    const { deps, ran } = setup({
      check: { ...PREPARED, ...fields, code: "ok" },
    });
    const outcome = await release(TARGET, deps);
    noRawOutput(outcome);
    expect(changed(ran)).toEqual([]);
    return outcome;
  };
  expect(await refused({ os: "centos", os_version: "9" })).toEqual({
    ok: false,
    code: "unsupported_os",
    os: "centos",
    version: "9",
    arch: "x86_64",
  });
  expect(await refused({ os: "debian", os_version: "10" })).toMatchObject({
    code: "unsupported_os",
  });
  expect(await refused({ systemd: "no" })).toMatchObject({
    code: "unsupported_os",
  });
  expect(await refused({ arch: "$(reboot)" })).toEqual({
    ok: false,
    code: "unsupported_os",
    os: "debian",
    version: "12",
    arch: "unknown",
  });
  expect(await refused({ holder: "other" })).toEqual({
    ok: false,
    code: "other_app_present",
  });
  expect(await refused({ port80: "taken" })).toEqual({
    ok: false,
    code: "port_80_taken",
  });
  expect(await refused({ disk_free_mb: "300" })).toEqual({
    ok: false,
    code: "disk_full",
    diskFreeMb: 300,
  });
});

test("a release readies a server that is not ready for this project first, sending Bun only when the server lacks it and only the build Bun published", async () => {
  const fresh = setup({
    check: { ...PREPARED, holder: "none", bun: "no", unit: "no", code: "ok" },
  });
  // The fake download is not the published build, so nothing is sent.
  expect(await release(TARGET, fresh.deps)).toEqual({
    ok: false,
    code: "runtime_download_failed",
  });
  expect(fresh.downloads).toHaveLength(1);
  expect(fresh.downloads[0]).toContain(`bun-v${BUN.version}/`);
  expect(changed(fresh.ran)).toEqual([]);

  const withBun = setup({
    check: { ...PREPARED, holder: "none", unit: "no", code: "ok" },
  });
  expect(await release(TARGET, withBun.deps)).toMatchObject({ ok: true });
  expect(withBun.downloads).toEqual([]);
  expect(withBun.ran.map(({ script }) => script)).toEqual([
    "status",
    "check",
    "prepare",
    "release",
  ]);
  expect(withBun.ran[2]).toEqual({
    script: "prepare",
    args: [PROJECT, BUN.version, "none"],
  });

  const ready = setup({});
  expect(await release(TARGET, ready.deps)).toMatchObject({ ok: true });
  expect(changed(ready.ran).map(({ script }) => script)).toEqual(["release"]);
});

test("a server the runtime reached damaged, or that a prepare found taken, stops the release before it starts", async () => {
  const unprepared = { ...PREPARED, holder: "none", unit: "no", code: "ok" };
  for (const [answer, expected] of [
    [
      { code: "runtime_mismatch" },
      { ok: false, code: "runtime_download_failed" },
    ],
    [{ code: "other_app_present" }, { ok: false, code: "other_app_present" }],
    [{ code: "busy" }, { ok: false, code: "busy" }],
    [
      { code: "unexpected", step: "unit" },
      { ok: false, code: "unexpected", step: "unit" },
    ],
    [{}, { ok: false, code: "unexpected", step: "prepare" }],
  ] as const) {
    const { deps, ran, recorded } = setup({
      check: unprepared,
      prepare: answer,
    });
    expect(await release(TARGET, deps)).toEqual(expected);
    expect(ran.map(({ script }) => script)).not.toContain("release");
    expect(recorded).toEqual([]);
  }
});

test("an app that does not say how it runs in production is refused before anything reaches the server", async () => {
  for (const production of [
    null,
    { ...PRODUCTION, port: "port" },
    { ...PRODUCTION, build: "bun run build\nreboot" },
    { ...PRODUCTION, data: ["../etc"] },
  ]) {
    const { deps, ran, recorded } = setup(
      {},
      { "stack.production": production },
    );
    expect(await release(TARGET, deps)).toEqual({
      ok: false,
      code: "not_publishable",
    });
    expect(ran).toEqual([]);
    expect(recorded).toEqual([]);
  }
});

test("a release passes each production setting as its own argument, the time its install and build have, and the app as a tar of its files", async () => {
  const { deps, ran } = setup({});
  await release(TARGET, deps);
  const sent = ran.find(({ script }) => script === "release");
  const [project, , seconds, ...rest] = sent?.args ?? [];
  expect(project).toBe(PROJECT);
  // Whole seconds, ending before the agent's ten-minute run does.
  expect(Number.isInteger(Number(seconds))).toBe(true);
  expect(Number(seconds)).toBeGreaterThan(0);
  expect(Number(seconds)).toBeLessThan(10 * 60);
  expect(rest).toEqual([
    "bun install --frozen-lockfile",
    "bun run build",
    "bun run start",
    "PORT",
    "server/data",
  ]);
  const files = await new Bun.Archive(sent?.stdin ?? new Uint8Array()).files();
  expect([...files.keys()].sort()).toEqual([
    "package.json",
    "server/src/index.ts",
  ]);
});

test("a release that fails records nothing and hands back only its code, never a server path, a release id or what the server printed", async () => {
  const log = "/srv/builder/logs/20261117100000000-0123456789ab.log";
  const cases: [Record<string, string>, Outcome][] = [
    [
      { code: "app_not_built", stage: "install", step: "install" },
      { ok: false, code: "app_not_built", step: "install" },
    ],
    [
      { code: "app_not_built", step: "build" },
      { ok: false, code: "app_not_built", step: "build" },
    ],
    [
      { code: "build_timed_out", step: "install" },
      { ok: false, code: "build_timed_out", step: "install" },
    ],
    [
      { code: "disk_full", disk_free_mb: "80" },
      { ok: false, code: "disk_full", diskFreeMb: 80 },
    ],
    [
      { code: "did_not_start", rolled_back: "yes" },
      { ok: false, code: "did_not_start", rolledBack: "yes" },
    ],
    [
      { code: "rollback_failed", rolled_back: "no" },
      { ok: false, code: "rollback_failed", rolledBack: "no" },
    ],
    [{ code: "busy" }, { ok: false, code: "busy" }],
    [
      { code: "unexpected", step: "snapshot", log },
      { ok: false, code: "unexpected", step: "snapshot" },
    ],
    [
      { code: "unexpected", step: "/srv/builder" },
      { ok: false, code: "unexpected", step: "release" },
    ],
    [
      { code: "something else" },
      { ok: false, code: "unexpected", step: "release" },
    ],
  ];
  for (const [answer, expected] of cases) {
    const { deps, recorded } = setup({ release: answer });
    const outcome = await release(TARGET, deps);
    expect(outcome).toEqual(expected);
    expect(JSON.stringify(outcome)).not.toMatch(/\/srv\/|20261117/);
    noRawOutput(outcome);
    expect(recorded).toEqual([]);
  }
});

test("a cancelled call reaches the server's connection, and is not explained as the server's failure", async () => {
  const controller = new AbortController();
  // What the connection throws once the call it carries is cancelled.
  const cancelled = sshFailure("cancelled");
  const { deps } = setup({});
  const signals: (AbortSignal | undefined)[] = [];
  const server = await deps.server();
  deps.signal = controller.signal;
  deps.server = async () => ({
    ...server,
    exec: async (argv, options) => {
      signals.push(options.signal);
      if (argv[2] === serverScript("check")) {
        controller.abort();
        throw cancelled;
      }
      return server.exec(argv, options);
    },
  });
  await expect(release(TARGET, deps)).rejects.toBe(cancelled);
  expect(signals.length).toBeGreaterThan(0);
  for (const signal of signals) expect(signal).toBe(controller.signal);
});

test("a release the server runs but the internet cannot reach is recorded, so it can be taken down", async () => {
  const { deps, recorded } = setup(
    { release: { code: "ok" } },
    undefined,
    false,
  );
  expect(await release(TARGET, deps)).toEqual({
    ok: false,
    code: "unreachable_from_outside",
    url: "http://203.0.113.7/",
  });
  expect(recorded).toEqual([
    {
      target: TARGET,
      url: "http://203.0.113.7/",
      version: VERSION,
      at: "2026-11-17T10:00:00.000Z",
    },
  ]);
});

// The release id an earlier publish of the saved version with these settings gave the server.
async function releasedAs(production: typeof PRODUCTION) {
  const { deps, ran } = setup({}, { "stack.production": production });
  await release(TARGET, deps);
  const id = ran.find(({ script }) => script === "release")?.args[1];
  if (id === undefined) throw new Error("no release was sent");
  return id;
}

// A server that runs and answers the release with this id.
const runningRelease = (id: string) => ({
  code: "ok",
  holder: "this",
  release: id,
  running: "yes",
  answering: "yes",
});

test("a server that already runs the saved version with its production settings and answers has it recorded without a rebuild", async () => {
  const running = runningRelease(await releasedAs(PRODUCTION));
  const { deps, ran, recorded } = setup({ status: running });
  expect(await release(TARGET, deps)).toEqual({
    ok: true,
    url: "http://203.0.113.7/",
  });
  expect(changed(ran)).toEqual([]);
  expect(recorded).toEqual([
    {
      target: TARGET,
      url: "http://203.0.113.7/",
      version: VERSION,
      at: "2026-11-17T10:00:00.000Z",
    },
  ]);

  // Another version, or one that does not answer there, is released anew.
  for (const status of [
    { ...running, release: "20261117090000000-fedcba987654" },
    { ...running, answering: "no" },
  ]) {
    const again = setup({ status });
    expect(await release(TARGET, again.deps)).toMatchObject({ ok: true });
    expect(changed(again.ran).map(({ script }) => script)).toEqual(["release"]);
  }
});

test("a server that runs the saved version with other production settings gets a release that applies the new ones", async () => {
  const earlier = await releasedAs(PRODUCTION);
  for (const production of [
    { ...PRODUCTION, install: "bun install" },
    { ...PRODUCTION, build: "bun run build:prod" },
    { ...PRODUCTION, start: "bun run start:prod" },
    { ...PRODUCTION, port: "HTTP_PORT" },
    { ...PRODUCTION, data: ["server/data", "server/uploads"] },
  ]) {
    const { deps, ran } = setup(
      { status: runningRelease(earlier) },
      { "stack.production": production },
    );
    expect(await release(TARGET, deps)).toMatchObject({ ok: true });
    const sent = ran.find(({ script }) => script === "release");
    expect(sent?.args.slice(3)).toEqual([
      production.install,
      production.build,
      production.start,
      production.port,
      ...production.data,
    ]);
  }
});

test("a report outside its script's vocabulary is refused as unexpected, never read as an answer", async () => {
  const { running, ...adoptable } = runningRelease(
    await releasedAs(PRODUCTION),
  );
  for (const answer of [
    { ...adoptable, runing: running },
    { ...adoptable, running: "true" },
    { ...adoptable, running, code: "fine" },
  ]) {
    const { deps, ran, recorded } = setup({ status: answer });
    expect(await release(TARGET, deps)).toEqual({
      ok: false,
      code: "unexpected",
      step: "status",
    });
    expect(changed(ran)).toEqual([]);
    expect(recorded).toEqual([]);
    expect(await status(setup({ status: answer }).deps)).toEqual({
      ok: false,
      code: "unexpected",
      step: "status",
    });
  }

  for (const answer of [
    { code: "did_not_start", rolledback: "yes" },
    { code: "did_not_start", rolled_back: "true" },
  ]) {
    const { deps, recorded } = setup({ release: answer });
    expect(await release(TARGET, deps)).toEqual({
      ok: false,
      code: "unexpected",
      step: "release",
    });
    expect(recorded).toEqual([]);
  }

  const { deps, ran } = setup({
    check: { ...PREPARED, systemd: "true", code: "ok" },
  });
  expect(await release(TARGET, deps)).toEqual({
    ok: false,
    code: "unexpected",
    step: "look",
  });
  expect(changed(ran)).toEqual([]);
});

test("a release that answers from outside is recorded once, by the tool, with the version the archive held, and hands back only the address", async () => {
  const { deps, recorded } = setup({});
  expect(await release(TARGET, deps)).toEqual({
    ok: true,
    url: "http://203.0.113.7/",
  });
  expect(recorded).toEqual([
    {
      target: TARGET,
      url: "http://203.0.113.7/",
      version: VERSION,
      at: "2026-11-17T10:00:00.000Z",
    },
  ]);
});

test("status says what is up in fixed words", async () => {
  const state = async (fields: Record<string, string>) =>
    status(setup({ status: { code: "ok", ...fields } }).deps);
  expect(await state({ holder: "none" })).toEqual({
    ok: true,
    state: "not_published",
  });
  expect(await state({ holder: "other" })).toEqual({
    ok: false,
    code: "other_app_present",
  });
  expect(
    await state({
      holder: "this",
      release: "r1",
      running: "no",
      answering: "no",
    }),
  ).toEqual({ ok: true, state: "stopped" });
  expect(
    await state({
      holder: "this",
      release: "r1",
      running: "yes",
      answering: "yes",
    }),
  ).toEqual({
    ok: true,
    state: "running",
    url: "http://203.0.113.7/",
    answersFromOutside: true,
  });
});

test("unpublish acts only on the person's go-ahead for the release recorded now, and clears it", async () => {
  const agreed = setup({}, AGREED);
  expect(await unpublish(TARGET, agreed.deps)).toEqual({ ok: true });
  expect(agreed.recorded).toEqual([null]);

  for (const answer of [
    null,
    { target: "cloud", release: RELEASED.at },
    { target: TARGET, release: "2026-11-17T08:00:00.000Z" },
  ]) {
    const { deps, ran, recorded } = setup(
      {},
      { ...AGREED, "publish.take-down": answer },
    );
    expect(await unpublish(TARGET, deps)).toEqual({
      ok: false,
      code: "not_agreed",
    });
    expect(ran).toEqual([]);
    expect(recorded).toEqual([]);
  }
});
