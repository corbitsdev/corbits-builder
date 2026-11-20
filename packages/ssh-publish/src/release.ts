import { type, type Type } from "arktype";
import { sshCredentialFailure, type SshCredentialFailure } from "@intx/types";
import type { RunHub } from "@corbits-builder/plugin/run-hub";
import {
  failed,
  type Outcome as PluginOutcome,
} from "@corbits-builder/plugin/tools";
import { declaredProduction } from "@corbits-builder/plugin";
import {
  RELEASE,
  PublishRelease,
  TAKE_DOWN_VALUES,
  takeDownAgreed,
  clearedFor,
} from "@corbits-builder/publishing";
import { serverScript } from "./scripts.ts" with { type: "macro" };
import type { ScriptName } from "./scripts.ts";
import {
  appTar,
  isReleaseOf,
  releaseId,
  type Production,
} from "./release-archive.ts";
import { BUN, bunBinary, isArch, sha256, type Arch } from "./runtime.ts";

// Below this a release's install and build are likely to fill the disk.
const MIN_FREE_MB = 1024;

// The codes a tool fails with. The agent's skills explain each one.
export const CODES = [
  "unreachable",
  "auth_failed",
  "host_key_changed",
  "address_refused",
  "server_timeout",
  "key_invalid",
  "unsupported_os",
  "port_80_taken",
  "disk_full",
  "other_app_present",
  "busy",
  "runtime_download_failed",
  "not_publishable",
  "app_not_saved",
  "builder_unavailable",
  "app_not_built",
  "build_timed_out",
  "did_not_start",
  "rollback_failed",
  "unreachable_from_outside",
  "unexpected",
  "not_agreed",
] as const;
export type Code = (typeof CODES)[number];

// A tool returns ok, or one code with a few typed fields. It never returns what the server printed.
export type Outcome = PluginOutcome<Code>;

/** One command on the server, as Interchange's ssh credential runs it. */
export type Server = {
  readonly address: { readonly host: string; readonly port: number };
  exec(
    argv: readonly string[],
    options: {
      stdin?: Uint8Array;
      timeoutMs: number;
      maxOutputBytes?: number;
      signal?: AbortSignal;
    },
  ): Promise<{ code: number | null; stdout: string }>;
};

export type Deps = {
  server(): Promise<Server>;
  hub: RunHub;
  // Whether the URL gives any HTTP response to a request from where the tools run, outside the
  // server.
  answersFromOutside(url: string): Promise<boolean>;
  download(url: string): Promise<Uint8Array>;
  now(): Date;
  // The tool call's signal. Aborting it closes the connection, and that ends the script on the
  // server.
  signal: AbortSignal;
};

// An agent with no workspace has ten minutes for its whole run, model turns included. A tool call
// has no separate limit: the end of the run aborts it. A release stops itself well before that, so
// the agent has turns left to explain what happened.
const MINUTE = 60_000;
const RELEASE_LIMIT_MS = 7 * MINUTE;
// Three tries from outside, each up to ten seconds, three seconds apart.
const OUTSIDE_MS = 40_000;
// The release script's waits after the build: a minute for the new release to answer, a minute for
// the previous release after a roll-back, and time to copy the data and switch releases.
const SWITCH_MS = 3 * MINUTE;
// Less than this for the install and the build together is not worth starting.
const MIN_BUILD_MS = MINUTE;
const LIMITS = {
  check: MINUTE,
  // Writing the runtime, some 90 MB, to a server on a slow line.
  prepare: 3 * MINUTE,
  status: MINUTE,
  unpublish: 2 * MINUTE,
};
const MAX_OUTPUT_BYTES = 16_384;

const CONNECTION: Readonly<Partial<Record<SshCredentialFailure, Code>>> = {
  unreachable: "unreachable",
  auth_failed: "auth_failed",
  host_key_changed: "host_key_changed",
  address_refused: "address_refused",
  timeout: "server_timeout",
  invalid_secret: "key_invalid",
  invalid_origin: "key_invalid",
  address_mismatch: "key_invalid",
};

// The code for an ssh credential failure. Any other error, including a cancelled call, is not a
// connection failure, so it has no code here.
function connectionCode(error: unknown): Code | undefined {
  const failure = sshCredentialFailure(error);
  return failure === undefined ? undefined : CONNECTION[failure];
}

// The steps a script names where it stopped.
const Step = type.enumerated(
  "look",
  "prepare",
  "runtime",
  "unit",
  "release",
  "unpack",
  "data",
  "install",
  "build",
  "snapshot",
  "switch",
  "rollback",
  "prune",
  "status",
  "unpublish",
);
type Step = typeof Step.infer;

const YesNo = type("'yes' | 'no'");

// How any script ends without its own report: it stopped where it did not expect to, naming the
// step, or a parameter reached it in a shape the tool never sends. A script that stops part-way may
// have reported anything before it stopped, so the rest of that report is dropped.
const Stopped = type({ "+": "delete", code: "'unexpected'", "step?": Step }).or(
  { "+": "reject", code: "'invalid_parameter'" },
);
// What a script that changes the server reports while another such script holds the lock.
const Busy = type({ "+": "reject", code: "'busy'" });

const CheckReport = type({
  "+": "reject",
  code: "'ok'",
  os: "string",
  os_version: "string",
  arch: "string",
  systemd: YesNo,
  disk_free_mb: "string.integer.parse",
  port80: "'free' | 'ours' | 'taken'",
  holder: "'none' | 'this' | 'other'",
  bun: YesNo,
  unit: YesNo,
});

const PrepareReport = type({
  "+": "reject",
  code: "'ok' | 'other_app_present' | 'runtime_mismatch'",
});

// Each step of a release before the app stops reports that it started; only the last one is kept.
const releasing = {
  "+": "reject",
  "stage?": "'unpack' | 'data' | 'install' | 'build' | 'snapshot'",
} as const;
const ReleaseReport = type({ ...releasing, code: "'ok'" })
  .or({
    ...releasing,
    code: "'app_not_built' | 'build_timed_out'",
    step: "'install' | 'build'",
  })
  .or({
    ...releasing,
    code: "'disk_full'",
    disk_free_mb: "string.integer.parse",
  })
  .or({
    ...releasing,
    code: "'did_not_start' | 'rollback_failed'",
    rolled_back: "'yes' | 'no' | 'none'",
  })
  .or({ "+": "reject", code: "'other_app_present'" });

// What the server runs is reported only when it holds this project's app.
const StatusReport = type({
  "+": "reject",
  code: "'ok'",
  holder: "'none' | 'other'",
}).or({
  "+": "reject",
  code: "'ok'",
  holder: "'this'",
  "release?": "string > 0",
  running: YesNo,
  answering: YesNo,
});

const UnpublishReport = type({
  "+": "reject",
  code: "'ok' | 'other_app_present'",
});

/**
 * A server script: its text, the step it names when it stops without saying where, whether it holds
 * the server's lock, and the one shape of what it reports.
 */
type Script<Report extends Type> = {
  text: string;
  step: Step;
  locks: boolean;
  report: Report;
};

const SCRIPTS = {
  check: {
    text: serverScript("check"),
    step: "look",
    locks: false,
    report: CheckReport,
  },
  prepare: {
    text: serverScript("prepare"),
    step: "prepare",
    locks: true,
    report: PrepareReport,
  },
  release: {
    text: serverScript("release"),
    step: "release",
    locks: true,
    report: ReleaseReport,
  },
  status: {
    text: serverScript("status"),
    step: "status",
    locks: false,
    report: StatusReport,
  },
  unpublish: {
    text: serverScript("unpublish"),
    step: "unpublish",
    locks: true,
    report: UnpublishReport,
  },
} satisfies Record<ScriptName, Script<Type>>;

// The key=value lines a script prints, the last value of a key winning. The rest of its output is
// ignored.
function fieldsOf(stdout: string) {
  const fields = new Map<string, string>();
  for (const line of stdout.split("\n")) {
    const match = /^([a-z0-9_]+)=(.{0,200})$/.exec(line);
    if (match?.[1] !== undefined && match[2] !== undefined)
      fields.set(match[1], match[2]);
  }
  return Object.fromEntries(fields);
}

// Runs a script and checks its report against the script's shape. A report of any other shape is
// unexpected, so a misspelt key or a word outside the script's vocabulary never reads as an answer.
async function runScript<Report extends Type>(
  deps: Deps,
  server: Server,
  script: Script<Report>,
  args: readonly string[],
  timeoutMs: number,
  stdin?: Uint8Array,
): Promise<Report["infer"] | Outcome> {
  let stdout: string;
  try {
    // Builder signs in as root, so the script runs as root without asking for it.
    ({ stdout } = await server.exec(
      ["/bin/sh", "-c", script.text, "builder", ...args],
      {
        timeoutMs,
        maxOutputBytes: MAX_OUTPUT_BYTES,
        signal: deps.signal,
        ...(stdin === undefined ? {} : { stdin }),
      },
    ));
  } catch (error) {
    const code = connectionCode(error);
    if (code === undefined) throw error;
    return failed(code);
  }
  const fields = fieldsOf(stdout);
  const stopped = Stopped(fields);
  if (!(stopped instanceof type.errors))
    return failed("unexpected", {
      step:
        stopped.code === "unexpected"
          ? (stopped.step ?? script.step)
          : script.step,
    });
  if (script.locks && !(Busy(fields) instanceof type.errors))
    return failed("busy");
  const report = script.report(fields);
  if (report instanceof type.errors)
    return failed("unexpected", { step: script.step });
  return report;
}

// A report never has ok, which every outcome has.
const isOutcome = <Report extends object>(
  value: Report | Outcome,
): value is Outcome => "ok" in value;

type Facts = { arch: Arch; prepared: boolean; hasBun: boolean };

const supportedOs = (os: string, version: string) => {
  const major = Number(version.split(".")[0]);
  return (os === "debian" && major >= 11) || (os === "ubuntu" && major >= 20);
};

// A reported word the agent may read, or "unknown" when it is not a short plain word.
const word = (value: string) =>
  /^[A-Za-z0-9._-]{1,40}$/.test(value) ? value : "unknown";

// What the server runs and whether this project's app can go on it, or the code that says why not.
async function look(
  deps: Deps,
  server: Server,
  projectId: string,
): Promise<Facts | Outcome> {
  const report = await runScript(
    deps,
    server,
    SCRIPTS.check,
    [projectId, BUN.version],
    LIMITS.check,
  );
  if (isOutcome(report)) return report;
  const os = word(report.os);
  const version = word(report.os_version);
  const arch = word(report.arch);
  if (!supportedOs(os, version) || report.systemd !== "yes" || !isArch(arch))
    return failed("unsupported_os", { os, version, arch });
  if (report.holder === "other") return failed("other_app_present");
  if (report.port80 === "taken") return failed("port_80_taken");
  if (report.disk_free_mb < MIN_FREE_MB)
    return failed("disk_full", { diskFreeMb: report.disk_free_mb });
  const hasBun = report.bun === "yes";
  return {
    arch,
    prepared: report.holder === "this" && hasBun && report.unit === "yes",
    hasBun,
  };
}

const isFacts = (value: Facts | Outcome): value is Facts => !("ok" in value);

// Sets up the server for this project's app: a user, folders, the runtime and the service that
// runs the app. It skips what is done already, so it is safe to run again.
async function prepare(
  deps: Deps,
  server: Server,
  projectId: string,
  facts: Facts,
): Promise<Outcome | undefined> {
  let binary: Uint8Array | undefined;
  if (!facts.hasBun) {
    binary = await bunBinary(deps.download, facts.arch);
    if (binary === undefined) return failed("runtime_download_failed");
  }
  const report = await runScript(
    deps,
    server,
    SCRIPTS.prepare,
    [projectId, BUN.version, binary === undefined ? "none" : sha256(binary)],
    LIMITS.prepare,
    binary,
  );
  if (isOutcome(report)) return report;
  switch (report.code) {
    case "ok":
      return undefined;
    case "other_app_present":
      return failed(report.code);
    // The runtime that reached the server is not the one sent, so treat it as a failed download.
    case "runtime_mismatch":
      return failed("runtime_download_failed");
  }
}

// How the app runs in production, as the release script takes it, or undefined when the project
// does not say.
async function production(hub: RunHub) {
  const declared = declaredProduction(await hub.values(["stack.production"]));
  if (declared === undefined || declared instanceof type.errors)
    return undefined;
  return declared;
}

/** The address people open the app at: plain HTTP on the server's own address. */
function appUrl(address: Server["address"]) {
  const host = address.host.includes(":") ? `[${address.host}]` : address.host;
  return `http://${host}/`;
}

// Records the release, then checks whether people can open it. By now the release script has
// switched to the release and started it, so it is live whether or not it answers from outside.
// It is recorded first because only a recorded release is offered to be taken down.
async function recorded(
  deps: Deps,
  target: string,
  server: Server,
  version: string,
  at: Date,
): Promise<Outcome> {
  const url = appUrl(server.address);
  const published: PublishRelease = {
    target,
    url,
    version,
    at: at.toISOString(),
  };
  await deps.hub.record({ [RELEASE.name]: published });
  if (!(await deps.answersFromOutside(url)))
    return failed("unreachable_from_outside", { url });
  // The release is recorded already; the person needs only the address.
  return { ok: true, url };
}

// Whether the server already runs this saved version of the app with these production settings,
// and it answers there, or the code that says why that cannot be told. That happens when a release
// went out but was not recorded, because the connection dropped after the switch or recording
// failed.
async function runsAlready(
  deps: Deps,
  server: Server,
  projectId: string,
  version: string,
  runs: Production,
): Promise<boolean | Outcome> {
  const report = await runScript(
    deps,
    server,
    SCRIPTS.status,
    [projectId],
    LIMITS.status,
  );
  if (isOutcome(report)) return report;
  return (
    report.holder === "this" &&
    report.release !== undefined &&
    isReleaseOf(report.release, version, runs) &&
    report.running === "yes" &&
    report.answering === "yes"
  );
}

/**
 * Publishes the saved app to the server, setting the server up first if it is not ready for this
 * project. Once the server runs the release, records it under `target`, the publish target's
 * handle. If the server already runs the saved version with the same production settings, records
 * it without a rebuild.
 */
export async function release(target: string, deps: Deps): Promise<Outcome> {
  const deadline = performance.now() + RELEASE_LIMIT_MS;
  const runs = await production(deps.hub);
  if (runs === undefined) return failed("not_publishable");
  const app = await deps.hub.source();
  if (app === undefined) return failed("app_not_saved");
  const server = await deps.server();
  const projectId = await deps.hub.projectId();
  const runsNow = await runsAlready(deps, server, projectId, app.version, runs);
  if (runsNow === true)
    return recorded(deps, target, server, app.version, deps.now());
  if (runsNow !== false) return runsNow;
  const tar = await appTar(app.files);
  const facts = await look(deps, server, projectId);
  if (!isFacts(facts)) return facts;
  if (!facts.prepared) {
    const refused = await prepare(deps, server, projectId, facts);
    if (refused !== undefined) return refused;
  }
  const left = deadline - performance.now() - OUTSIDE_MS;
  const buildMs = left - SWITCH_MS;
  if (buildMs < MIN_BUILD_MS) return failed("server_timeout");
  const at = deps.now();
  const report = await runScript(
    deps,
    server,
    SCRIPTS.release,
    [
      projectId,
      releaseId(at, app.version, runs),
      String(Math.floor(buildMs / 1000)),
      runs.install,
      runs.build,
      runs.start,
      runs.port,
      ...runs.data,
    ],
    left,
    tar,
  );
  if (isOutcome(report)) return report;
  // The server's output stays in its log under the release's name. The person needs neither the
  // output nor the release id, so the agent gets neither.
  switch (report.code) {
    case "ok":
      break;
    case "app_not_built":
    case "build_timed_out":
      return failed(report.code, { step: report.step });
    case "disk_full":
      return failed(report.code, { diskFreeMb: report.disk_free_mb });
    case "did_not_start":
    case "rollback_failed":
      return failed(report.code, { rolledBack: report.rolled_back });
    case "other_app_present":
      return failed(report.code);
  }
  return recorded(deps, target, server, app.version, at);
}

/** Whether the app is published on the server and answers, there and from outside. */
export async function status(deps: Deps): Promise<Outcome> {
  const server = await deps.server();
  const report = await runScript(
    deps,
    server,
    SCRIPTS.status,
    [await deps.hub.projectId()],
    LIMITS.status,
  );
  if (isOutcome(report)) return report;
  if (report.holder === "other") return failed("other_app_present");
  if (report.holder !== "this" || report.release === undefined)
    return { ok: true, state: "not_published" };
  if (report.running === "no") return { ok: true, state: "stopped" };
  if (report.answering === "no") return { ok: true, state: "not_answering" };
  const url = appUrl(server.address);
  return {
    ok: true,
    state: "running",
    url,
    answersFromOutside: await deps.answersFromOutside(url),
  };
}

/**
 * Takes the app down, keeping its data, and clears the recorded release for `target`. It runs only
 * while the person's go-ahead on the take-down screen still covers what is published now.
 */
export async function unpublish(target: string, deps: Deps): Promise<Outcome> {
  const values = await deps.hub.values(TAKE_DOWN_VALUES);
  if (!takeDownAgreed(values, target)) return failed("not_agreed");
  const report = await runScript(
    deps,
    await deps.server(),
    SCRIPTS.unpublish,
    [await deps.hub.projectId()],
    LIMITS.unpublish,
  );
  if (isOutcome(report)) return report;
  if (report.code === "other_app_present") return failed(report.code);
  await deps.hub.record(clearedFor(target, values));
  return { ok: true };
}
