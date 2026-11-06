import { existsSync, readFileSync, readlinkSync, realpathSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";

// Stops every process of this app on this machine: hubs, migrations, UI dev
// servers and the sidecars, live-app hosts and build tools they spawned, from
// this checkout or any other checkout of the same package. Other projects'
// `bun run dev` processes are left alone, as is a Docker Compose stack; when
// one of those holds a port `bun run dev` needs, it is named instead.

export const APP_NAME = "corbits-builder";

export type ProcessInfo = {
  pid: number;
  ppid: number;
  command: string;
  /** Working directory, when known. */
  cwd?: string | undefined;
};

export type Selection = {
  /** The pid of this script; it and its ancestors are never selected. */
  self: number;
  /** Maps a directory to the checkout root of this app containing it, if any. */
  checkoutOf: (directory: string) => string | undefined;
};

const entryPatterns = [
  // The hub (`bun run start` execs it) and the migration runner.
  /(^|\s)apps\/hub\/src\/(server|migrate)\.ts(\s|$)/,
  // The package.json wrappers: `bun run dev`, `bun run --parallel dev:hub dev:web`, `bun run start`.
  /(^|\s)run\s+(--\S+\s+)*(dev|dev:hub|dev:web|start)(\s|$)/,
  // The UI dev server.
  /(^|\/)vite(\s|$)/,
];

const checkoutSubpaths = [
  "apps",
  "vendor",
  "node_modules",
  "packages",
  "workflows",
];

function executableOf(command: string) {
  return command.split(" ")[0] ?? "";
}

/** A JavaScript runtime or a tool installed in a checkout, never an editor or a terminal that merely names the checkout. */
function isAppExecutable(executable: string) {
  const name = basename(executable);
  return (
    name === "bun" || name === "node" || executable.includes("/node_modules/")
  );
}

function runsFileOfCheckout(command: string, root: string) {
  return checkoutSubpaths.some((subpath) =>
    command.includes(`${root}/${subpath}/`),
  );
}

function ancestorsOf(pid: number, byPid: Map<number, ProcessInfo>) {
  const ancestors = new Set<number>();
  for (
    let current = byPid.get(pid);
    current && !ancestors.has(current.pid);
    current = byPid.get(current.ppid)
  ) {
    ancestors.add(current.pid);
  }
  return ancestors;
}

/** The processes to stop: every process launched from a checkout of this app, plus everything they spawned. */
export function selectAppProcesses(
  processes: ProcessInfo[],
  selection: Selection,
): ProcessInfo[] {
  const byPid = new Map(processes.map((info) => [info.pid, info]));
  const excluded = ancestorsOf(selection.self, byPid);
  const roots = new Set<string>();
  for (const info of processes) {
    const root =
      info.cwd === undefined ? undefined : selection.checkoutOf(info.cwd);
    if (root !== undefined) roots.add(root);
  }
  const selected = new Set<number>();
  for (const info of processes) {
    if (excluded.has(info.pid) || !isAppExecutable(executableOf(info.command)))
      continue;
    const cwdRoot =
      info.cwd === undefined ? undefined : selection.checkoutOf(info.cwd);
    const byEntry =
      cwdRoot !== undefined &&
      entryPatterns.some((pattern) => pattern.test(info.command));
    const byPath = [...roots].some((root) =>
      runsFileOfCheckout(info.command, root),
    );
    if (byEntry || byPath) selected.add(info.pid);
  }
  // Children inherit the selection: sidecars, workflow children, esbuild services, sandboxed builds.
  let grew = true;
  while (grew) {
    grew = false;
    for (const info of processes) {
      if (
        selected.has(info.pid) ||
        excluded.has(info.pid) ||
        !selected.has(info.ppid)
      )
        continue;
      selected.add(info.pid);
      grew = true;
    }
  }
  return processes.filter((info) => selected.has(info.pid));
}

/** A port `bun run dev` listens on and the variable that sets it. */
export type NeededPort = {
  variable: "PORT" | "UI_PORT";
  port: number;
  /** What listens there. */
  role: string;
};

export type Listener = { port: number; pid: number };

type Env = Record<string, string | undefined>;

/** The `KEY=value` lines of a dotenv file, without the quoting and expansion Bun applies; enough for a port. */
export function parseDotenv(text: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const match =
      /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!match) continue;
    const [, key, raw] = match;
    const value = raw ?? "";
    values[key ?? ""] = /^(["']).*\1$/.test(value)
      ? value.slice(1, -1)
      : (value.split(" #")[0]?.trim() ?? "");
  }
  return values;
}

function readDotenv(path: string) {
  try {
    return parseDotenv(readFileSync(path, "utf8"));
  } catch {
    return {};
  }
}

function portOf(...candidates: (string | undefined)[]) {
  for (const candidate of candidates) {
    if (candidate === undefined) continue;
    const port = Number(candidate);
    if (Number.isInteger(port) && port > 0 && port < 65536) return port;
  }
  return undefined;
}

/**
 * The ports `bun run dev` needs, resolved as it resolves them: the shell wins
 * over the checkout's env files, which win over the defaults.
 */
export function neededPorts(
  shell: Env,
  hubEnv: Env,
  webEnv: Env,
): NeededPort[] {
  return [
    {
      variable: "PORT",
      port: portOf(shell["PORT"], hubEnv["PORT"]) ?? 8000,
      role: "the hub",
    },
    {
      variable: "UI_PORT",
      port: portOf(shell["UI_PORT"], webEnv["UI_PORT"]) ?? 5173,
      role: "the UI dev server",
    },
  ];
}

/** Parses `lsof -Fpn` output: a `p<pid>` line followed by `n<address>` lines. */
export function parseLsofListeners(output: string): Listener[] {
  const listeners: Listener[] = [];
  let pid: number | undefined;
  for (const line of output.split("\n")) {
    if (line.startsWith("p")) pid = Number(line.slice(1));
    else if (line.startsWith("n") && pid !== undefined) {
      const port = Number(line.slice(line.lastIndexOf(":") + 1));
      if (Number.isInteger(port)) listeners.push({ port, pid });
    }
  }
  return listeners;
}

/** Parses `ss -Hltnp` output: one socket per line, the pid in `users:(("name",pid=N,fd=M))`. */
export function parseSsListeners(output: string): Listener[] {
  const listeners: Listener[] = [];
  for (const line of output.split("\n")) {
    const columns = line.trim().split(/\s+/);
    const local = columns[3] ?? "";
    const port = Number(local.slice(local.lastIndexOf(":") + 1));
    for (const match of line.matchAll(/pid=(\d+)/g))
      if (Number.isInteger(port))
        listeners.push({ port, pid: Number(match[1]) });
  }
  return listeners;
}

function listenersOn(ports: number[]): Listener[] {
  if (ports.length === 0) return [];
  if (existsSync("/proc/self")) {
    return parseSsListeners(run(["ss", "-Hltnp"])).filter((listener) =>
      ports.includes(listener.port),
    );
  }
  return parseLsofListeners(
    run([
      "lsof",
      "-nP",
      ...ports.map((port) => `-iTCP:${port}`),
      "-sTCP:LISTEN",
      "-Fpn",
    ]),
  );
}

/** A port published by a container reaches the host through a forwarder, not the container itself. */
function isContainerForwarder(command: string) {
  return /docker|colima|lima|vpnkit|podman|orbstack/i.test(command);
}

/** Lines naming what holds each needed port, other than the given pids. */
export function describeHeldPorts(
  needed: NeededPort[],
  listeners: Listener[],
  commandOf: (pid: number) => string | undefined,
  ignore: Set<number> = new Set(),
): string[] {
  const lines: string[] = [];
  for (const { variable, port, role } of needed) {
    const holders = new Map<number, string>();
    for (const listener of listeners)
      if (listener.port === port && !ignore.has(listener.pid))
        holders.set(listener.pid, commandOf(listener.pid) ?? "(unknown)");
    for (const [pid, command] of holders) {
      const hint = isContainerForwarder(command)
        ? " (a container's published port; see `docker ps`)"
        : "";
      lines.push(
        `  ${String(port).padStart(6)}  ${variable} for ${role}: held by pid ${pid}  ${command}${hint}`,
      );
    }
  }
  return lines;
}

function run(command: string[]) {
  const result = Bun.spawnSync(command, { stdout: "pipe", stderr: "pipe" });
  return result.stdout.toString();
}

function listProcesses(): ProcessInfo[] {
  const processes: ProcessInfo[] = [];
  for (const line of run(["ps", "-axo", "pid=,ppid=,command="]).split("\n")) {
    const match = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
    if (match)
      processes.push({
        pid: Number(match[1]),
        ppid: Number(match[2]),
        command: (match[3] ?? "").trimEnd(),
      });
  }
  return processes;
}

/** Working directories of the given pids, from /proc where it exists and from lsof elsewhere. */
function workingDirectories(pids: number[]) {
  const cwds = new Map<number, string>();
  if (pids.length === 0) return cwds;
  if (existsSync("/proc/self")) {
    for (const pid of pids) {
      try {
        cwds.set(pid, readlinkSync(`/proc/${pid}/cwd`));
      } catch {
        // The process is gone or belongs to someone else; it is not ours to stop.
      }
    }
    return cwds;
  }
  let pid: number | undefined;
  for (const line of run([
    "lsof",
    "-a",
    "-d",
    "cwd",
    "-p",
    pids.join(","),
    "-Fpn",
  ]).split("\n")) {
    if (line.startsWith("p")) pid = Number(line.slice(1));
    else if (line.startsWith("n") && pid !== undefined)
      cwds.set(pid, line.slice(1));
  }
  return cwds;
}

function packageName(directory: string) {
  try {
    const parsed: unknown = JSON.parse(
      readFileSync(resolve(directory, "package.json"), "utf8"),
    );
    return typeof parsed === "object" && parsed !== null && "name" in parsed
      ? parsed.name
      : undefined;
  } catch {
    return undefined;
  }
}

/** Finds the nearest enclosing checkout of this app, remembering the answer per directory. */
export function createCheckoutResolver(appName = APP_NAME) {
  const known = new Map<string, string | undefined>();
  const resolveRoot = (directory: string): string | undefined => {
    const cached = known.get(directory);
    if (cached !== undefined || known.has(directory)) return cached;
    const parent = dirname(directory);
    const root =
      packageName(directory) === appName
        ? directory
        : parent === directory
          ? undefined
          : resolveRoot(parent);
    known.set(directory, root);
    return root;
  };
  return (directory: string) => {
    try {
      return resolveRoot(realpathSync(directory));
    } catch {
      return undefined;
    }
  };
}

function isAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function signal(pid: number, name: NodeJS.Signals) {
  try {
    process.kill(pid, name);
  } catch {
    // Already gone.
  }
}

const describe = (info: ProcessInfo) =>
  `  ${String(info.pid).padStart(6)}  ${info.command.length > 110 ? `${info.command.slice(0, 107)}...` : info.command}`;

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const gracePeriod = 10_000;
  const checkoutOf = createCheckoutResolver();
  const scan = () => {
    const processes = listProcesses();
    const candidates = processes.filter((info) =>
      isAppExecutable(executableOf(info.command)),
    );
    const cwds = workingDirectories(candidates.map((info) => info.pid));
    for (const candidate of candidates) candidate.cwd = cwds.get(candidate.pid);
    return selectAppProcesses(processes, { self: process.pid, checkoutOf });
  };
  const checkout = resolve(import.meta.dir, "..");
  const needed = neededPorts(
    process.env,
    readDotenv(resolve(checkout, ".env.hub")),
    readDotenv(resolve(checkout, ".env.web")),
  );
  const reportHeldPorts = (ignore?: Set<number>) => {
    const byPid = new Map(listProcesses().map((info) => [info.pid, info]));
    const lines = describeHeldPorts(
      needed,
      listenersOn(needed.map(({ port }) => port)),
      (pid) => byPid.get(pid)?.command,
      ignore,
    );
    if (lines.length === 0) return;
    console.log(
      `Ports \`bun run dev\` needs are held by something this script does not stop:`,
    );
    for (const line of lines) console.log(line);
    console.log(
      "Stop it, or set PORT in .env.hub (and UI_HUB_ORIGIN in .env.web) or UI_PORT in .env.web.",
    );
  };
  const selected = scan();
  if (selected.length === 0) {
    console.log(`Nothing from ${APP_NAME} is running.`);
    reportHeldPorts();
    return;
  }
  console.log(
    `${dryRun ? "Would stop" : "Stopping"} ${selected.length} ${APP_NAME} process${selected.length === 1 ? "" : "es"}:`,
  );
  for (const info of selected) console.log(describe(info));
  if (dryRun) {
    reportHeldPorts(new Set(selected.map((info) => info.pid)));
    return;
  }
  // Parents get the signal first and shut their own children down; the rest is swept afterwards.
  const pids = new Set(selected.map((info) => info.pid));
  for (const info of selected)
    if (!pids.has(info.ppid)) signal(info.pid, "SIGTERM");
  const deadline = Date.now() + gracePeriod;
  while (Date.now() < deadline && [...pids].some(isAlive)) await Bun.sleep(200);
  const remaining = [
    ...scan().map((info) => info.pid),
    ...[...pids].filter(isAlive),
  ];
  for (const pid of new Set(remaining)) signal(pid, "SIGKILL");
  await Bun.sleep(200);
  const survivors = [...new Set(remaining)].filter(isAlive);
  if (survivors.length > 0) {
    console.error(`Could not stop: ${survivors.join(", ")}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    `Stopped ${selected.length} process${selected.length === 1 ? "" : "es"}.`,
  );
  reportHeldPorts();
}

if (import.meta.main) await main();
