import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { hasCode } from "@intx/types";
import type {
  LocalSidecarExit,
  ReclaimLocalSidecar,
  SpawnLocalSidecar,
} from "./local-provisioner.ts";

/** The variables a sidecar needs to find binaries and scratch space; nothing else from the hub env crosses over. */
type ChildProcessEnv = { PATH?: string; HOME?: string; TMPDIR?: string };

export function childProcessEnv(
  env: Record<string, string | undefined>,
): ChildProcessEnv {
  const { PATH, HOME, TMPDIR } = env;
  return {
    ...(PATH !== undefined && { PATH }),
    ...(HOME !== undefined && { HOME }),
    ...(TMPDIR !== undefined && { TMPDIR }),
  };
}

type CreateLocalSidecarLauncherOpts = {
  readonly interchangeDir: string;
  readonly credentialEncryptionKey: string;
  readonly maxActiveDeployments: number;
  readonly processEnv: ChildProcessEnv;
};

const SIDECAR_ENTRY = "apps/sidecar/src/index.ts";
const WATCHDOG_ENTRY = path.join(import.meta.dir, "watchdog.ts");
// How long a sidecar left running waits for a hub to answer before it stops itself.
const ORPHAN_TIMEOUT_MS = 10 * 60_000;
const EXIT_POLL_MS = 100;

// Signals a process that is still running; false when it no longer exists.
function sendSignal(pid: number, name: NodeJS.Signals | 0): boolean {
  try {
    process.kill(pid, name);
    return true;
  } catch (error) {
    if (hasCode(error) && error.code === "ESRCH") return false;
    throw error;
  }
}

type ProcessRow = {
  readonly pid: number;
  readonly ppid: number;
  readonly command: string;
};

function processes(pid?: number): ProcessRow[] {
  const ps = Bun.spawnSync(
    [
      "ps",
      "-ww",
      "-o",
      "pid=,ppid=,command=",
      ...(pid === undefined ? ["-A"] : ["-p", String(pid)]),
    ],
    { stderr: "ignore" },
  );
  return ps.stdout
    .toString()
    .split("\n")
    .flatMap((line) => {
      const match = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
      return match === null
        ? []
        : [
            {
              pid: Number(match[1]),
              ppid: Number(match[2]),
              command: match[3]!,
            },
          ];
    });
}

function commandAt(pid: number): string | undefined {
  return processes(pid)[0]?.command;
}

function hasArgument(command: string, argument: string): boolean {
  return `${command} `.includes(` ${argument} `);
}

// Signals `pid` only while it still runs `command`, so a pid the system has since reused is never signalled.
function signalIfStill(
  pid: number,
  command: string,
  name: NodeJS.Signals | 0,
): boolean {
  return commandAt(pid) === command && sendSignal(pid, name);
}

async function stopProcessAt(
  pid: number,
  command: string,
  timeoutMs: number,
): Promise<void> {
  for (const name of ["SIGTERM", "SIGKILL"] as const) {
    if (!signalIfStill(pid, command, name)) return;
    for (const deadline = Date.now() + timeoutMs; Date.now() < deadline;) {
      if (!signalIfStill(pid, command, 0)) return;
      await Bun.sleep(EXIT_POLL_MS);
    }
  }
  throw new Error(`Local sidecar process ${String(pid)} did not exit`);
}

/**
 * Stop the sidecar a hub from before data-dir tagging left running at `pid`, so two processes never share one
 * identity and data dir. A pid that runs anything else, a tagged sidecar included, is left alone.
 */
export async function stopStaleLocalSidecar(
  pid: number,
  timeoutMs: number,
): Promise<boolean> {
  const command = commandAt(pid);
  if (
    command === undefined ||
    !command.includes(SIDECAR_ENTRY) ||
    command.includes("--data-dir=")
  )
    return false;
  await stopProcessAt(pid, command, timeoutMs);
  return true;
}

async function exitOf(child: Bun.Subprocess): Promise<LocalSidecarExit> {
  const code = await child.exited;
  const signal = child.signalCode;
  return {
    code: signal === null ? code : null,
    signal: signal === null ? null : String(signal),
  };
}

function recordedInterchangeRevision(interchangeDir: string): string {
  try {
    const manifest: unknown = JSON.parse(
      readFileSync(`${interchangeDir}.manifest.json`, "utf8"),
    );
    if (
      manifest !== null &&
      typeof manifest === "object" &&
      "revision" in manifest &&
      typeof manifest.revision === "string"
    )
      return manifest.revision;
  } catch (error) {
    if (!(hasCode(error) && error.code === "ENOENT")) throw error;
  }
  return "unrecorded";
}

export function createLocalSidecarLauncher({
  interchangeDir,
  credentialEncryptionKey,
  maxActiveDeployments,
  processEnv,
}: CreateLocalSidecarLauncherOpts): {
  readonly spawnSidecar: SpawnLocalSidecar;
  readonly reclaimSidecar: ReclaimLocalSidecar;
} {
  const interchangeRevision = recordedInterchangeRevision(interchangeDir);
  const absolute = (dataDir: string) => path.resolve(interchangeDir, dataDir);

  // Everything the sidecar is spawned from; a sidecar spawned from anything else is not adopted.
  const fingerprintOf: (...args: Parameters<SpawnLocalSidecar>) => string = ({
    manifest,
    adapterManifest,
  }) =>
    createHash("sha256")
      .update(
        JSON.stringify([
          interchangeRevision,
          manifest.hubWebSocketUrl,
          manifest.sidecarId,
          manifest.token,
          absolute(manifest.dataDir),
          credentialEncryptionKey,
          maxActiveDeployments,
          processEnv,
          adapterManifest,
          ORPHAN_TIMEOUT_MS,
        ]),
      )
      .digest("hex");

  const spawnSidecar: SpawnLocalSidecar = (args) => {
    const { manifest, adapterManifest } = args;
    const child = Bun.spawn(
      [
        "bun",
        WATCHDOG_ENTRY,
        `--data-dir=${absolute(manifest.dataDir)}`,
        `--fingerprint=${fingerprintOf(args)}`,
        `--orphan-timeout-ms=${String(ORPHAN_TIMEOUT_MS)}`,
      ],
      {
        cwd: interchangeDir,
        env: {
          ...processEnv,
          HUB_WS_URL: manifest.hubWebSocketUrl,
          SIDECAR_ID: manifest.sidecarId,
          SIDECAR_TOKEN: manifest.token,
          SIDECAR_DATA_DIR: manifest.dataDir,
          SIDECAR_CREDENTIAL_ENCRYPTION_KEY: credentialEncryptionKey,
          SIDECAR_ADAPTER_MANIFEST: JSON.stringify(adapterManifest),
          SIDECAR_MAX_ACTIVE_DEPLOYMENTS: String(maxActiveDeployments),
        },
        stdin: "ignore",
        stdout: "inherit",
        stderr: "inherit",
      },
    );
    return {
      pid: child.pid,
      exited: exitOf(child),
      kill(signal) {
        child.kill(signal);
      },
      release() {
        child.unref();
      },
    };
  };

  // Any process tagged with the data dir is ours, whoever started it: one spawned from exactly the inputs given is
  // adopted, and every other one is stopped, so two sidecars never run on one data dir.
  const reclaimSidecar: ReclaimLocalSidecar = async ({
    dataDir,
    spawnedFrom,
    timeoutMs,
  }) => {
    const tag = `--data-dir=${absolute(dataDir)}`;
    const ours = processes().filter(
      ({ command }) =>
        (command.includes(WATCHDOG_ENTRY) || command.includes(SIDECAR_ENTRY)) &&
        hasArgument(command, tag),
    );
    const fingerprint =
      spawnedFrom === undefined
        ? undefined
        : `--fingerprint=${fingerprintOf(spawnedFrom)}`;
    const kept =
      fingerprint === undefined
        ? undefined
        : ours.find(
            ({ command }) =>
              command.includes(WATCHDOG_ENTRY) &&
              hasArgument(command, fingerprint),
          );
    await Promise.all(
      ours
        .filter((row) => row !== kept && row.ppid !== kept?.pid)
        .map(({ pid, command }) => stopProcessAt(pid, command, timeoutMs)),
    );
    if (kept === undefined) return undefined;
    const { pid, command } = kept;
    let released = false;
    const exited = (async (): Promise<LocalSidecarExit> => {
      while (signalIfStill(pid, command, 0)) {
        // A released sidecar outlives this hub, so its exit is never seen here.
        if (released) return new Promise<never>(() => undefined);
        await Bun.sleep(EXIT_POLL_MS);
      }
      return { code: null, signal: null };
    })();
    return {
      pid,
      exited,
      kill(signal) {
        signalIfStill(pid, command, signal);
      },
      release() {
        released = true;
      },
    };
  };

  return { spawnSidecar, reclaimSidecar };
}
