import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appTar } from "./release-archive.ts";
import { serverScript, type ScriptName } from "./scripts.ts";

// The scripts run as root on Debian or Ubuntu, with GNU coreutils and util-linux; elsewhere they
// are only parsed.
const linux =
  process.platform === "linux" &&
  Bun.which("flock") !== null &&
  Bun.which("timeout") !== null;

const PROJECT = "00000000-0000-4000-8000-000000000001";
const NAMES: ScriptName[] = [
  "check",
  "prepare",
  "release",
  "status",
  "unpublish",
];

test("every script parses as sh", () => {
  for (const name of NAMES) {
    const parsed = Bun.spawnSync(["sh", "-n", "-c", serverScript(name)]);
    expect({ name, exit: parsed.exitCode }).toEqual({ name, exit: 0 });
  }
});

// One stub of each system command the scripts change the machine with, recording what it was asked
// in the state folder: the service answers once it is started on a release whose start command
// says serve, and a release whose start says crash writes to the data before it fails, as an app
// that migrates its database and then dies would.
function stubs(at: string, root: string, state: string) {
  const real = (name: string) => {
    const found = Bun.which(name);
    if (found === null) throw new Error(`${name} is missing`);
    return found;
  };
  const files: Record<string, string> = {
    systemctl: `
echo "$*" >>"${state}/systemctl"
case $1 in
  is-active) exec test -f "${state}/active" ;;
  stop) rm -f "${state}/active" "${state}/answering" ;;
  disable) rm -f "${state}/active" "${state}/answering" ;;
  start | restart)
    touch "${state}/active"
    rm -f "${state}/answering"
    if grep -q serve "${root}/current/start" 2>/dev/null; then touch "${state}/answering"; fi
    if grep -q crash "${root}/current/start" 2>/dev/null; then touch "${root}/data/server/data/written-by-crash"; fi
    ;;
esac
exit 0`,
    runuser: `
while [ "$1" != -- ]; do shift; done
shift
exec "$@"`,
    useradd: "exit 0",
    id: "exit 0",
    chown: "exit 0",
    sleep: "exit 0",
    cp: `
if [ "$1" = -a ] && [ "$2" = "${root}/data" ]; then
  if [ -f "${state}/active" ]; then echo running >>"${state}/copied"; else echo stopped >>"${state}/copied"; fi
fi
exec ${real("cp")} "$@"`,
    mv: `
if [ -f "${state}/fail-restore" ] && [ "$2" = "${root}/snapshots/$(cat "${state}/fail-restore")" ]; then exit 1; fi
exec ${real("mv")} "$@"`,
    df: `
if [ -f "${state}/free-kb" ]; then
  echo "Filesystem 1024-blocks Used Available Capacity Mounted on"
  echo "disk 1000000 0 $(cat "${state}/free-kb") 1% /"
  exit 0
fi
exec ${real("df")} "$@"`,
  };
  mkdirSync(at, { recursive: true });
  for (const [name, body] of Object.entries(files))
    writeFileSync(join(at, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
}

// The script as the tool sends it, with its fixed places moved under a temporary folder and the
// stubs first on its PATH. Each line is replaced exactly, so a change to them fails here first.
function composed(name: ScriptName, base: string) {
  let text = serverScript(name);
  const moves: [string, string][] = [
    ["PATH=/usr/local/sbin", `PATH=${base}/stubs:/usr/local/sbin`],
    ["ROOT=/srv/builder\n", `ROOT=${base}/srv/builder\n`],
    ["BUN_HOME=/opt/builder\n", `BUN_HOME=${base}/opt/builder\n`],
    [
      "UNIT_FILE=/etc/systemd/system/builder-app.service\n",
      `UNIT_FILE=${base}/etc/builder-app.service\n`,
    ],
  ];
  for (const [from, to] of moves) {
    expect(text.split(from).length).toBe(2);
    text = text.replace(from, to);
  }
  return text;
}

type Report = Record<string, string>;

describe.skipIf(!linux)("the server scripts on a machine", () => {
  let base: string;
  let root: string;
  let state: string;
  let releases: number;

  beforeEach(() => {
    releases = 0;
    base = mkdtempSync(join(tmpdir(), "server-scripts-"));
    root = join(base, "srv/builder");
    state = join(base, "state");
    mkdirSync(state);
    mkdirSync(join(base, "etc"));
    stubs(join(base, "stubs"), root, state);
    // The runtime a prepared server has: here it only says whether the app answers.
    mkdirSync(join(base, "opt/builder/bun-1.4.4/bin"), { recursive: true });
    writeFileSync(
      join(base, "opt/builder/bun-1.4.4/bin/bun"),
      `#!/bin/sh\n[ -f "${state}/answering" ]\n`,
      { mode: 0o755 },
    );
  });

  afterEach(() => rmSync(base, { recursive: true, force: true }));

  const start = (name: ScriptName, args: string[], stdin?: Uint8Array) =>
    Bun.spawn(["/bin/sh", "-c", composed(name, base), "builder", ...args], {
      stdin: stdin === undefined ? "ignore" : new Blob([stdin]),
      stdout: "pipe",
      stderr: "ignore",
    });

  const finished = async (run: ReturnType<typeof start>): Promise<Report> => {
    const stdout = await new Response(run.stdout).text();
    await run.exited;
    return Object.fromEntries(
      stdout
        .split("\n")
        .filter((line) => line.includes("=") && !line.startsWith("stage="))
        .map((line) => [
          line.slice(0, line.indexOf("=")),
          line.slice(line.indexOf("=") + 1),
        ]),
    );
  };

  const run = (name: ScriptName, args: string[], stdin?: Uint8Array) =>
    finished(start(name, args, stdin));

  const prepare = () => run("prepare", [PROJECT, "1.4.4", "none"]);

  const releaseId = () =>
    `2026111710000${String(releases++).padStart(4, "0")}-0123456789ab`;

  const app = (files: Record<string, string> = {}) =>
    appTar(
      new Map(
        Object.entries({ "package.json": "{}", ...files }).map(
          ([path, text]) => [path, new TextEncoder().encode(text)],
        ),
      ),
    );

  const releaseRun = async (
    options: {
      id?: string;
      startCommand?: string;
      install?: string;
      seconds?: string;
      files?: Record<string, string>;
    } = {},
  ) =>
    start(
      "release",
      [
        PROJECT,
        options.id ?? releaseId(),
        options.seconds ?? "60",
        options.install ?? "true",
        "true",
        options.startCommand ?? "bun serve",
        "PORT",
        "server/data",
      ],
      await app(options.files),
    );

  const release = async (options: Parameters<typeof releaseRun>[0] = {}) =>
    finished(await releaseRun(options));

  const current = () => readlinkSync(join(root, "current"));
  const kept = (path: string) => join(root, "data/server/data", path);
  const read = (path: string) => readFileSync(path, "utf8");

  test("a prepared server takes a release whose data folder is a link into the kept data, and what people entered survives the next one", async () => {
    expect(await prepare()).toEqual({ code: "ok" });

    const first = releaseId();
    expect(
      await release({ id: first, files: { "server/data/seed.txt": "seed" } }),
    ).toEqual({ code: "ok" });
    expect(current()).toBe(`releases/${first}`);
    expect(read(kept("seed.txt"))).toBe("seed");
    expect(readlinkSync(join(root, current(), "app/server/data"))).toBe(
      join(root, "data/server/data"),
    );
    writeFileSync(kept("entered.txt"), "entered");

    const second = releaseId();
    expect(
      await release({ id: second, files: { "server/data/seed.txt": "new" } }),
    ).toEqual({ code: "ok" });
    expect(current()).toBe(`releases/${second}`);
    expect(read(kept("entered.txt"))).toBe("entered");
    expect(read(kept("seed.txt"))).toBe("seed");
    // The copy of the data was taken with the app stopped.
    expect(read(join(state, "copied"))).toBe("stopped\nstopped\n");
    expect(
      read(join(root, "snapshots", second, "server/data/entered.txt")),
    ).toBe("entered");
  });

  test("a release that never answers puts back the release before and the data as it was, and a first one leaves nothing published", async () => {
    await prepare();
    expect(await release({ startCommand: "crash" })).toEqual({
      code: "did_not_start",
      rolled_back: "none",
    });
    expect(existsSync(join(root, "current"))).toBe(false);
    expect(readdirSync(join(root, "releases"))).toEqual([]);

    const first = releaseId();
    await release({ id: first });
    writeFileSync(kept("entered.txt"), "entered");

    const failing = releaseId();
    expect(await release({ id: failing, startCommand: "crash" })).toEqual({
      code: "did_not_start",
      rolled_back: "yes",
    });
    expect(current()).toBe(`releases/${first}`);
    expect(read(kept("entered.txt"))).toBe("entered");
    expect(existsSync(kept("written-by-crash"))).toBe(false);
    expect(existsSync(join(root, "releases", failing))).toBe(false);
    expect(existsSync(join(state, "answering"))).toBe(true);
  });

  test("a restore that fails keeps the copy of the data, puts the release before back and says it needs attention", async () => {
    await prepare();
    const first = releaseId();
    await release({ id: first });
    writeFileSync(kept("entered.txt"), "entered");

    const failing = releaseId();
    writeFileSync(join(state, "fail-restore"), failing);
    expect(await release({ id: failing, startCommand: "crash" })).toEqual({
      code: "rollback_failed",
      rolled_back: "yes",
    });
    expect(current()).toBe(`releases/${first}`);
    expect(read(kept("entered.txt"))).toBe("entered");
    const copy = join(root, "snapshots", failing, "server/data");
    expect(read(join(copy, "entered.txt"))).toBe("entered");
    expect(existsSync(join(copy, "written-by-crash"))).toBe(false);
  });

  test("a second release while one runs is refused as busy, and the first completes", async () => {
    await prepare();
    // The first release's install says it began, then holds the server until the test lets it go.
    const began = join(state, "installing");
    const go = join(state, "go");
    const running = await releaseRun({
      install: `touch ${began}; until [ -f ${go} ]; do sleep 0.05; done`,
    });
    while (!existsSync(began)) await Bun.sleep(20);
    expect(await release()).toEqual({ code: "busy" });
    expect(await run("unpublish", [PROJECT])).toEqual({ code: "busy" });
    writeFileSync(go, "");
    expect(await finished(running)).toEqual({ code: "ok" });
  });

  test("a release whose connection is gone stops before it changes anything, and leaves the server free", async () => {
    await prepare();
    const first = releaseId();
    await release({ id: first });
    const gone = Bun.spawn(
      [
        "/bin/sh",
        "-c",
        'exec /bin/sh -c "$0" builder "$@" >&-',
        composed("release", base),
        PROJECT,
        releaseId(),
        "60",
        "true",
        "true",
        "bun serve",
        "PORT",
        "server/data",
      ],
      { stdin: new Blob([await app()]), stdout: "ignore", stderr: "ignore" },
    );
    await gone.exited;
    expect(current()).toBe(`releases/${first}`);
    expect(readdirSync(join(root, "releases"))).toEqual([first]);
    expect(await release()).toEqual({ code: "ok" });
  });

  test("an install that runs past its time is stopped and reported, and the server takes the next release", async () => {
    await prepare();
    const first = releaseId();
    await release({ id: first });
    expect(await release({ install: "sleep 30", seconds: "1" })).toEqual({
      code: "build_timed_out",
      step: "install",
    });
    expect(current()).toBe(`releases/${first}`);
    expect(await release({ install: "false" })).toEqual({
      code: "app_not_built",
      step: "install",
    });
    expect(await release()).toEqual({ code: "ok" });
  });

  test("a disk without room for a copy of the data refuses the release before anything is stopped or switched", async () => {
    await prepare();
    const first = releaseId();
    await release({ id: first });
    rmSync(join(state, "systemctl"));
    writeFileSync(join(state, "free-kb"), "1024");
    expect(await release()).toEqual({ code: "disk_full", disk_free_mb: "1" });
    expect(current()).toBe(`releases/${first}`);
    expect(existsSync(join(state, "systemctl"))).toBe(false);
    expect(readdirSync(join(root, "releases"))).toEqual([first]);
  });

  test("pruning keeps the newest three releases and data copies, and never the one running", async () => {
    await prepare();
    const [fifth, sixth, seventh] = ["5", "6", "7"].map(
      (n) => `2026111710000000${n}-0123456789ab`,
    ) as [string, string, string];
    for (const id of [fifth, sixth, seventh]) await release({ id });
    // A release whose name sorts first, as one from a clock set back would.
    const earliest = "20261117100000001-0123456789ab";
    expect(await release({ id: earliest })).toEqual({ code: "ok" });
    expect(readdirSync(join(root, "releases")).sort()).toEqual([
      earliest,
      fifth,
      sixth,
      seventh,
    ]);
    // One cut off before it went live leaves its folder behind.
    mkdirSync(join(root, "releases", "20261117100000007-cutoff"));
    const latest = "20261117100000008-0123456789ab";
    await release({ id: latest });
    for (const folder of ["releases", "snapshots"])
      expect(readdirSync(join(root, folder)).sort()).toEqual([
        sixth,
        seventh,
        latest,
      ]);
    expect(current()).toBe(`releases/${latest}`);
  });

  test("another project's server is refused, and unpublishing keeps the data", async () => {
    await prepare();
    await release();
    writeFileSync(kept("entered.txt"), "entered");
    const other = "00000000-0000-4000-8000-000000000002";
    expect(await run("prepare", [other, "1.4.4", "none"])).toEqual({
      code: "other_app_present",
    });
    expect(await run("unpublish", [other])).toEqual({
      code: "other_app_present",
    });
    expect(await run("unpublish", [PROJECT])).toEqual({ code: "ok" });
    expect(existsSync(join(state, "active"))).toBe(false);
    expect(read(kept("entered.txt"))).toBe("entered");
    expect(await run("status", [PROJECT])).toMatchObject({
      holder: "this",
      running: "no",
      code: "ok",
    });
  });
});
