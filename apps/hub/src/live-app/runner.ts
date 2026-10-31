import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getLogger } from "@intx/log";
import { errorCode, requestErrorMetadata } from "../request-error.ts";
import { liveAppWording } from "../config/live-app.ts";
import type { HostReport, HostSource } from "./host.ts";
import type { createLiveAppProxy } from "./proxy.ts";

const log = getLogger(["corbits-builder", "hub", "live-app"]);
const HOST = fileURLToPath(new URL("./host.ts", import.meta.url));
// The workspace page says it is open every few seconds; an app no one has opened for this long stops.
const GRACE_MS = 60_000;
const SWEEP_MS = 5_000;

// A source the host already follows is not sent again: a directory by its path, a bundle by its hash.
export type LiveAppSource = { key: string; source: HostSource };

type Run = {
  key: string;
  child: Bun.Subprocess<"pipe", "pipe", "pipe">;
  state: HostReport;
  stderr: string[];
  lastSeen: number;
};

/**
 * Runs each open project's app, one host process per project (host.ts), from a workspace of its
 * own under the hub's data directory. The app starts when the project is opened, follows its
 * source's files while it runs, and stops once no one has had the project open for a short while.
 */
export function createLiveAppRunner(options: {
  dataDir: string;
  lastUsed: (projectId: string) => number | undefined;
  onStop: (projectId: string) => void;
}) {
  const runs = new Map<string, Run>();

  function stop(projectId: string) {
    const run = runs.get(projectId);
    if (!run) return;
    runs.delete(projectId);
    options.onStop(projectId);
    run.child.kill("SIGTERM");
    setTimeout(() => run.child.kill("SIGKILL"), 10_000).unref();
  }

  const sweep = setInterval(() => {
    for (const [projectId, run] of runs)
      if (
        Math.max(run.lastSeen, options.lastUsed(projectId) ?? 0) <
        Date.now() - GRACE_MS
      )
        stop(projectId);
  }, SWEEP_MS);
  sweep.unref();

  async function follow(projectId: string, run: Run) {
    const decoder = new TextDecoder();
    let pending = "";
    try {
      for await (const chunk of run.child.stdout) {
        pending += decoder.decode(chunk, { stream: true });
        for (
          let end = pending.indexOf("\n");
          end !== -1;
          end = pending.indexOf("\n")
        ) {
          run.state = JSON.parse(pending.slice(0, end)) as HostReport;
          pending = pending.slice(end + 1);
        }
      }
    } catch (error) {
      log.warn("Reading the live app host's state failed for {projectId}", {
        projectId,
        ...errorCode(error),
        ...requestErrorMetadata(error),
      });
    }
  }

  async function collect(projectId: string, run: Run) {
    const decoder = new TextDecoder();
    try {
      for await (const chunk of run.child.stderr)
        for (const line of decoder.decode(chunk, { stream: true }).split("\n"))
          if (line.trim() && run.stderr.push(line) > 40) run.stderr.shift();
    } catch (error) {
      log.warn("Reading the live app host's stderr failed for {projectId}", {
        projectId,
        ...errorCode(error),
        ...requestErrorMetadata(error),
      });
    }
  }

  async function failOnExit(projectId: string, run: Run) {
    const code = await run.child.exited;
    if (runs.get(projectId) === run && run.state.state !== "failed")
      run.state = {
        state: "failed",
        error: liveAppWording.hostExited(code),
        log: run.stderr,
      };
  }

  function spawn(projectId: string, key: string) {
    const workspace = resolve(
      options.dataDir,
      "live-apps",
      projectId,
      "workspace",
    );
    mkdirSync(workspace, { recursive: true });
    const child = Bun.spawn(
      [process.execPath, ...process.execArgv, HOST, workspace],
      {
        // The host and the app see none of the hub's environment, which holds its secrets.
        env: {
          PATH: `${dirname(process.execPath)}:/usr/local/bin:/usr/bin:/bin`,
          ...(process.env["HOME"] ? { HOME: process.env["HOME"] } : {}),
          ...(process.env["TMPDIR"] ? { TMPDIR: process.env["TMPDIR"] } : {}),
        },
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const run: Run = {
      key,
      child,
      state: { state: "starting", phase: "starting", log: [] },
      stderr: [],
      lastSeen: Date.now(),
    };
    runs.set(projectId, run);
    void follow(projectId, run);
    void collect(projectId, run);
    void failOnExit(projectId, run);
    return run;
  }

  return {
    /** The project is open: its app runs from this source, started if it is not running. */
    async keepAlive(projectId: string, { key, source }: LiveAppSource) {
      let run = runs.get(projectId);
      if (run && run.child.exitCode !== null) {
        stop(projectId);
        run = undefined;
      }
      if (run) {
        run.lastSeen = Date.now();
        if (run.key === key) return;
        run.key = key;
      } else run = spawn(projectId, key);
      run.child.stdin.write(JSON.stringify(source) + "\n");
      await run.child.stdin.flush();
    },

    /** The project's app as its host last reported it, or undefined while it is not running. */
    state: (projectId: string): HostReport | undefined =>
      runs.get(projectId)?.state,

    stop,
    close() {
      clearInterval(sweep);
      for (const projectId of runs.keys()) stop(projectId);
    },
  };
}

export type LiveApps = {
  proxy: ReturnType<typeof createLiveAppProxy>;
  runner: ReturnType<typeof createLiveAppRunner>;
};
