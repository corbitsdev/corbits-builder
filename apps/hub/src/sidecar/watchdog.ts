// Runs the hub's local sidecar and stops it once no hub has answered for `--orphan-timeout-ms`, so a sidecar a hub
// left running across its restart never outlives the hub for good. Both processes carry `--data-dir` on their command
// line, which is how a hub finds the sidecar on its data dir; the sidecar ignores its arguments. `--fingerprint` only
// names the inputs it was spawned from, so a hub adopts it only while they still match.
import { parseArgs } from "node:util";

const SIDECAR_ENTRY = "apps/sidecar/src/index.ts";
const CHECK_INTERVAL_MS = 30_000;
const CHECK_TIMEOUT_MS = 5_000;
const STOP_GRACE_MS = 25_000;

const { values } = parseArgs({
  options: {
    "data-dir": { type: "string" },
    fingerprint: { type: "string" },
    "orphan-timeout-ms": { type: "string" },
  },
});
const dataDir = values["data-dir"];
const orphanTimeoutMs = Number(values["orphan-timeout-ms"]);
const hubWebSocketUrl = process.env["HUB_WS_URL"];
if (
  dataDir === undefined ||
  hubWebSocketUrl === undefined ||
  !(orphanTimeoutMs > 0)
)
  throw new Error(
    "Sidecar watchdog needs --data-dir, --orphan-timeout-ms and HUB_WS_URL",
  );
const hub = new URL(hubWebSocketUrl);
hub.protocol = hub.protocol === "wss:" ? "https:" : "http:";

const child = Bun.spawn(
  ["bun", "--conditions=intx-src", SIDECAR_ENTRY, `--data-dir=${dataDir}`],
  { stdin: "ignore", stdout: "inherit", stderr: "inherit" },
);
for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"] as const)
  process.on(signal, () => child.kill(signal));

// Any answer from the hub's origin counts: the sidecar reconnects on its own once a hub listens there again.
async function hubAnswers(): Promise<boolean> {
  try {
    const response = await fetch(hub.origin, {
      signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
    });
    await response.body?.cancel();
    return true;
  } catch {
    return false;
  }
}

let lastAnswered = Date.now();
const watch = setInterval(async () => {
  if (await hubAnswers()) {
    lastAnswered = Date.now();
    return;
  }
  if (Date.now() - lastAnswered < orphanTimeoutMs) return;
  clearInterval(watch);
  console.error(
    `Sidecar watchdog: no hub at ${hub.origin} for ${String(orphanTimeoutMs)} ms; stopping the sidecar`,
  );
  child.kill("SIGTERM");
  setTimeout(() => child.kill("SIGKILL"), STOP_GRACE_MS).unref();
}, CHECK_INTERVAL_MS);

const code = await child.exited;
clearInterval(watch);
process.exit(child.signalCode === null ? code : 1);
