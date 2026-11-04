import { hasCode } from "@intx/types";
import type {
  LocalSidecarExit,
  LocalSidecarProcess,
  SpawnLocalSidecar,
} from "./local-provisioner.ts";
import type { LocalSidecarPid } from "./manifest-store.ts";

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

type CreateSpawnLocalSidecarOpts = {
  readonly interchangeDir: string;
  readonly credentialEncryptionKey: string;
  readonly maxActiveDeployments: number;
  readonly processEnv: ChildProcessEnv;
};

const SIDECAR_ENTRY = "apps/sidecar/src/index.ts";
const EXIT_POLL_MS = 100;

// When the process at `pid` started, and its command. Together they tell one process from a later one that reuses
// its pid.
function processAt(pid: number): string | undefined {
  const ps = Bun.spawnSync(
    ["ps", "-o", "lstart=", "-o", "command=", "-p", String(pid)],
    { env: { ...process.env, LC_ALL: "C" }, stderr: "ignore" },
  );
  return ps.exitCode === 0 ? ps.stdout.toString().trim() : undefined;
}

/** The identity of the sidecar running at `pid`, or undefined when no sidecar runs there. */
function localSidecarIdentity(pid: number): string | undefined {
  const identity = processAt(pid);
  return identity?.includes(SIDECAR_ENTRY) ? identity : undefined;
}

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

/**
 * Stop the sidecar a hub that recorded no identity left running at `pid`, so two processes never share one identity
 * and data dir. The process is no child of this hub, so its exit is polled. A pid that no longer runs the
 * sidecar entry is left alone.
 */
export async function stopStaleLocalSidecar(
  pid: number,
  timeoutMs: number,
): Promise<boolean> {
  if (localSidecarIdentity(pid) === undefined) return false;
  for (const name of ["SIGTERM", "SIGKILL"] as const) {
    if (!sendSignal(pid, name)) return true;
    for (const deadline = Date.now() + timeoutMs; Date.now() < deadline;) {
      if (!sendSignal(pid, 0)) return true;
      await Bun.sleep(EXIT_POLL_MS);
    }
  }
  throw new Error(`Stale local sidecar process ${String(pid)} did not exit`);
}

/**
 * The sidecar a previous hub left running, when the process at `record.pid` is still the one it started. The process
 * is no child of this hub, so its exit is polled.
 */
export function adoptLocalSidecar(
  record: LocalSidecarPid,
): LocalSidecarProcess | undefined {
  const { pid, identity } = record;
  if (identity === undefined || localSidecarIdentity(pid) !== identity)
    return undefined;
  const exited = (async (): Promise<LocalSidecarExit> => {
    while (sendSignal(pid, 0)) await Bun.sleep(EXIT_POLL_MS);
    return { code: null, signal: null };
  })();
  return {
    pid,
    identity,
    exited,
    kill(signal) {
      sendSignal(pid, signal);
    },
  };
}

async function exitOf(child: Bun.Subprocess): Promise<LocalSidecarExit> {
  const code = await child.exited;
  const signal = child.signalCode;
  return {
    code: signal === null ? code : null,
    signal: signal === null ? null : String(signal),
  };
}

export function createSpawnLocalSidecar({
  interchangeDir,
  credentialEncryptionKey,
  maxActiveDeployments,
  processEnv,
}: CreateSpawnLocalSidecarOpts): SpawnLocalSidecar {
  return function spawnSidecar({ manifest, adapterManifest }) {
    const child = Bun.spawn(["bun", "--conditions=intx-src", SIDECAR_ENTRY], {
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
    });
    const identity = localSidecarIdentity(child.pid);
    return {
      pid: child.pid,
      ...(identity !== undefined && { identity }),
      exited: exitOf(child),
      kill(signal) {
        child.kill(signal);
      },
    };
  };
}
