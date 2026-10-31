// Runs one project's app for the hub, in the coder's sandbox, from the project's current files.
// srt's sandbox manager is process-global, so each app is a process of its own. Each stdin line
// names the source: a directory to follow (a build workspace, read here and never by the app) or
// a filed bundle. Its files are mirrored into the app's own workspace, packages are installed when
// they change, and `bun run dev` serves every later change. The app's state goes to stdout as one
// JSON object per line whenever it changes. Closing stdin or SIGTERM ends it.
import { createHash } from "node:crypto";
import { watch, type FSWatcher } from "node:fs";
import { access, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, sep } from "node:path";
import { type } from "arktype";
import { liveAppWording } from "../config/live-app.ts";
import { writeBundle } from "../artifacts/design-tools.ts";
import { bundleFiles, collectApp } from "../builds/app-snapshot.ts";
import { buildPackageLayout } from "../builds/package-layout.ts";
import {
  createPosixBuildExecutor,
  IGNORED_CHANGES,
} from "../builds/posix-sandbox.ts";

export type HostReport =
  | { state: "starting"; phase: "installing" | "starting"; log: string[] }
  | { state: "running"; url: string }
  | { state: "failed"; error: string; log: string[] };
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
const executor = await createPosixBuildExecutor(
  workspace,
  {
    commandTimeoutMs: INSTALL_TIMEOUT_MS + 10_000,
    maxToolResultBytes: 256 * 1024,
  },
  await buildPackageLayout(),
  // The person's running app installs its packages and reaches the services it was built against.
  { openNetwork: true },
).catch((error: unknown) => {
  report({
    state: "failed",
    error: error instanceof Error ? error.message : String(error),
    log: [],
  });
  process.exit(1);
});

// What this host last copied from a source, by digest, kept beside the workspace so a later host
// removes a file the source dropped while no one looked, and never a file the app wrote itself.
const manifest = join(dirname(workspace), "mirrored.json");
const mirrored = new Map<string, string>(
  Object.entries(
    await readFile(manifest, "utf8").then(
      (text) => JSON.parse(text) as Record<string, string>,
      () => ({}),
    ),
  ),
);
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
  if (changed.length)
    await writeFile(manifest, JSON.stringify(Object.fromEntries(mirrored)));
  return changed;
}

let installed = await access(join(workspace, "node_modules")).then(
  () => true,
  () => false,
);
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
    const result = await executor
      .run(
        {
          id: "install",
          name: "run_shell",
          arguments: { command: "bun install", timeout: INSTALL_TIMEOUT_MS },
        },
        AbortSignal.timeout(INSTALL_TIMEOUT_MS + 5_000),
      )
      .finally(() => (installing = false));
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

let queue: Promise<unknown> = Promise.resolve();
const enqueue = (work: () => Promise<void>) => {
  queue = queue.then(work).catch((error: unknown) => {
    failure = {
      error: error instanceof Error ? error.message : String(error),
      log: [],
    };
  });
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
    watcher.on("error", () => watcher?.close());
  } catch {
    watcher = undefined;
  }
  sync();
}

let closing = false;
const close = async (code: number) => {
  if (closing) return;
  closing = true;
  watcher?.close();
  await executor.dispose().catch(() => undefined);
  process.exit(code);
};
process.once("SIGTERM", () => void close(0));
void (async () => {
  const decoder = new TextDecoder();
  let buffered = "";
  for await (const chunk of Bun.stdin.stream()) {
    buffered += decoder.decode(chunk, { stream: true });
    const lines = buffered.split("\n");
    buffered = lines.pop() ?? "";
    for (const line of lines)
      if (line.trim()) follow(HostSource.assert(JSON.parse(line)));
  }
  await close(0);
})();

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
  const answers = await fetch(app.url, {
    signal: AbortSignal.timeout(STATE_MS),
  }).then(
    () => true,
    () => false,
  );
  report(
    answers
      ? { state: "running", url: app.url }
      : { state: "starting", phase: "starting", log: app.log },
  );
}, STATE_MS);
