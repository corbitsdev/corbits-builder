// Runs one project's app for the hub, in the coder's sandbox, from the project's current files.
// srt's sandbox manager is process-global, so each app is a process of its own. Each stdin line
// names the source: a directory to follow (a build workspace, read here and never by the app) or
// a filed bundle. Its files are mirrored into the app's own workspace, packages are installed when
// they change, and `bun run dev` serves every later change. The app's state goes to stdout as one
// JSON object per line whenever it changes. Closing stdin or SIGTERM ends it.
import { createHash } from "node:crypto";
import { existsSync, watch, type FSWatcher } from "node:fs";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, sep } from "node:path";
import { type } from "arktype";
import { hasCode } from "@intx/types";
import { liveAppWording } from "../config/live-app.ts";
import { errorCode } from "../request-error.ts";
import type { HostReport } from "./host-report.ts";
import { parseJson } from "../lib/json.ts";
import { writeBundle } from "../artifacts/design-bundle.ts";
import { bundleFiles, collectApp } from "../builds/app-snapshot.ts";
import { buildPackageLayout } from "../builds/package-layout.ts";
import {
  createPosixBuildExecutor,
  IGNORED_CHANGES,
} from "../builds/posix-sandbox.ts";

export const HostSource = type({ dir: "string > 0" }).or({
  files: { "[string]": "string" },
  "binary?": { "[string]": "string" },
});
export type HostSource = typeof HostSource.infer;

const INSTALL_TIMEOUT_MS = 280_000;
const SYNC_DEBOUNCE_MS = 150;
const STATE_MS = 1_000;
const tail = (output: string) => output.trim().split("\n").slice(-40);

if (!process.argv[2]) throw new Error("live_app_workspace_required");
const workspace = process.argv[2];
let last = "";
const report = (state: HostReport) => {
  const line = JSON.stringify(state);
  if (line === last) return;
  last = line;
  process.stdout.write(line + "\n");
};
const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

const stderrLine = (phrase: string, error: unknown) => {
  const { errorCode: code } = errorCode(error);
  process.stderr.write(
    code === undefined ? `${phrase}\n` : `${phrase} (${code})\n`,
  );
};

async function createExecutor() {
  const layout = await buildPackageLayout();
  try {
    return await createPosixBuildExecutor(
      workspace,
      {
        commandTimeoutMs: INSTALL_TIMEOUT_MS + 10_000,
        maxToolResultBytes: 256 * 1024,
      },
      layout,
      // The person's running app installs its packages and reaches the services it was built against.
      { openNetwork: true },
    );
  } catch (error) {
    report({ state: "failed", error: message(error), log: [] });
    process.exit(1);
  }
}
const executor = await createExecutor();

// What this host last copied from a source, by digest, kept beside the workspace so a later host
// removes a file the source dropped while no one looked, and never a file the app wrote itself.
const manifest = join(dirname(workspace), "mirrored.json");
async function readMirrored(): Promise<Record<string, string>> {
  if (!(await Bun.file(manifest).exists())) return {};
  const recorded = parseJson(await readFile(manifest, "utf8"));
  if (recorded !== undefined) return recorded as Record<string, string>;
  process.stderr.write(
    "The mirror record is not JSON; mirroring from scratch.\n",
  );
  return {};
}
const mirrored = new Map(Object.entries(await readMirrored()));
const contained = (path: string) =>
  join(workspace, path).startsWith(workspace + sep);

const digest = (data: string | Uint8Array) =>
  createHash("sha256").update(data).digest("hex");

async function mirror(files: Readonly<Record<string, string | Uint8Array>>) {
  const changed: string[] = [];
  const written: Record<string, string | Uint8Array> = {};
  for (const [path, data] of Object.entries(files))
    if (mirrored.get(path) !== digest(data) && contained(path))
      written[path] = data;
  await writeBundle(workspace, written);
  for (const [path, data] of Object.entries(written)) {
    mirrored.set(path, digest(data));
    changed.push(path);
  }
  for (const path of mirrored.keys())
    if (!(path in files)) {
      if (contained(path)) await rm(join(workspace, path), { force: true });
      mirrored.delete(path);
      changed.push(path);
    }
  if (changed.length) {
    // Renamed into place, so a host stopped mid-write never leaves a half-written record.
    const staged = manifest + ".tmp";
    await writeFile(staged, JSON.stringify(Object.fromEntries(mirrored)));
    await rename(staged, manifest);
  }
  return changed;
}

let installed = existsSync(join(workspace, "node_modules"));
let failure: { error: string; log: string[] } | undefined;
let installing = false;
// A crashed app is started again once; after that it waits for the next change to its files.
let restartedSinceChange = false;

async function apply(files: Readonly<Record<string, string | Uint8Array>>) {
  failure = undefined;
  const changed = await mirror(files);
  if (
    changed.some((path) =>
      ["package.json", "bun.lock"].includes(basename(path)),
    )
  )
    installed = false;
  if (changed.length) restartedSinceChange = false;
  if (!installed) {
    installing = true;
    let result;
    try {
      result = await executor.run(
        {
          id: "install",
          name: "run_shell",
          arguments: { command: "bun install", timeout: INSTALL_TIMEOUT_MS },
        },
        AbortSignal.timeout(INSTALL_TIMEOUT_MS + 5_000),
      );
    } finally {
      installing = false;
    }
    const output = String(result.content);
    if (result.isError || output.startsWith("exit code ")) {
      failure = {
        error: liveAppWording.commandFailed("bun install"),
        log: tail(output),
      };
      return;
    }
    installed = true;
    if (executor.appState()) await executor.restartApp();
  }
  const app = executor.appState();
  if (!app || !app.running || app.stopped !== undefined) await executor.app();
}

async function runAfter(previous: Promise<void>, work: () => Promise<void>) {
  await previous;
  try {
    await work();
  } catch (error) {
    failure = { error: message(error), log: [] };
  }
}
let queue: Promise<void> = Promise.resolve();
const enqueue = (work: () => Promise<void>) => {
  queue = runAfter(queue, work);
};

let watcher: FSWatcher | undefined;
let pending: Timer | undefined;
function follow(source: HostSource) {
  watcher?.close();
  watcher = undefined;
  if ("files" in source) return enqueue(() => apply(bundleFiles(source)));
  const { dir } = source;
  const sync = () =>
    enqueue(async () => apply(bundleFiles(await collectApp(dir))));
  try {
    watcher = watch(dir, { recursive: true }, (_event, file) => {
      if (file !== null && IGNORED_CHANGES.test(file)) return;
      clearTimeout(pending);
      pending = setTimeout(sync, SYNC_DEBOUNCE_MS);
    });
    // A build workspace goes away when its run ends; the hub then names the next source.
    watcher.on("error", (error) => {
      stderrLine("Watching the app's files stopped", error);
      watcher?.close();
    });
  } catch (error) {
    watcher = undefined;
    // A directory that is already gone fails the sync below, which reports it.
    if (!(hasCode(error) && error.code === "ENOENT"))
      stderrLine("Watching the app's files failed; the app syncs once", error);
  }
  sync();
}

let closing = false;
const close = async (code: number) => {
  if (closing) return;
  closing = true;
  watcher?.close();
  try {
    await executor.dispose();
  } catch (error) {
    // The hub keeps the host's stderr as the app's log.
    stderrLine("Disposing the app sandbox failed", error);
  }
  process.exit(code);
};
process.once("SIGTERM", () => void close(0));

function followLine(line: string) {
  const json = parseJson(line);
  const source = json === undefined ? undefined : HostSource(json);
  if (source === undefined || source instanceof type.errors) {
    process.stderr.write(
      `Skipped a source line: ${source === undefined ? "not JSON" : "not a valid source"}\n`,
    );
    return;
  }
  follow(source);
}

async function followStdin() {
  const decoder = new TextDecoder();
  let buffered = "";
  try {
    for await (const chunk of Bun.stdin.stream()) {
      buffered += decoder.decode(chunk, { stream: true });
      for (
        let end = buffered.indexOf("\n");
        end !== -1;
        end = buffered.indexOf("\n")
      ) {
        const line = buffered.slice(0, end);
        buffered = buffered.slice(end + 1);
        if (line.trim()) followLine(line);
      }
    }
  } catch (error) {
    stderrLine("The host stopped", error);
    return close(1);
  }
  await close(0);
}
void followStdin();

// Whether the app answers at all: any HTTP response means it is up.
async function answers(url: string) {
  try {
    await fetch(url, { signal: AbortSignal.timeout(STATE_MS) });
    return true;
  } catch (error) {
    if (
      error instanceof TypeError ||
      (error instanceof DOMException && error.name === "TimeoutError")
    )
      return false;
    throw error;
  }
}

setInterval(async () => {
  if (installing)
    return report({ state: "starting", phase: "installing", log: [] });
  if (failure) return report({ state: "failed", ...failure });
  const app = executor.appState();
  if (!app) return report({ state: "starting", phase: "starting", log: [] });
  if (!app.running || app.stopped !== undefined) {
    if (!restartedSinceChange) {
      restartedSinceChange = true;
      enqueue(async () => void (await executor.app()));
      return;
    }
    return report({
      state: "failed",
      error: app.running ? liveAppWording.partStopped : liveAppWording.stopped,
      log: app.log,
    });
  }
  report(
    (await answers(app.url))
      ? { state: "running", url: app.url }
      : { state: "starting", phase: "starting", log: app.log },
  );
}, STATE_MS);
