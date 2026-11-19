import { SandboxToolchains } from "@corbits-builder/schemas/installed-workflows";
// Runs one command against a saved app version for a check or a build, in the coder's sandbox.
// srt's sandbox manager is process-global, so each run is a separate process. stdin has the app's
// files and the command. The files go into the workspace named in argv. The command's setup runs
// if it declares one, then the command, or each of its lines in order until one fails, all on the
// network the project's builds reach. If the ask exports paths, they are packed into a zip outside
// the workspace once every line succeeded. One JSON line on stdout reports the result, and the
// process exits. SIGTERM stops the command and its sandbox first.
import { constants } from "node:fs";
import { lstat, open, readdir, realpath, writeFile } from "node:fs/promises";
import { join, sep } from "node:path";
import { type } from "arktype";
import JSZip from "jszip";
import { hasCode } from "@intx/types";
import { AppBundle } from "@corbits-builder/schemas/artifact";
import { writeBundle } from "../artifacts/design-tools.ts";
import { bundleFiles } from "../builds/app-snapshot.ts";
import { buildPackageLayout } from "../builds/package-layout.ts";
import { createPosixBuildExecutor, quote } from "../builds/posix-sandbox.ts";
import {
  runInSandbox,
  type SandboxCommand,
} from "../builds/sandbox-command.ts";

export const CommandAsk = type({
  "+": "reject",
  bundle: AppBundle,
  command: type({
    "+": "reject",
    "setup?": "(string > 0)[] >= 1",
    run: "(string > 0)[] >= 1",
  }).or({ "+": "reject", lines: "(string > 0)[] >= 1" }),
  timeoutMs: "number.integer > 0",
  // Whether the command reaches any public host rather than only the package registries.
  openNetwork: "boolean",
  // Toolchain folders the command reads but never writes.
  toolchains: SandboxToolchains,
  // Paths inside the app to pack, once every line succeeded, into a zip at archive, which is
  // outside the workspace. At most maxFiles files and maxBytes bytes.
  "export?": {
    "+": "reject",
    paths: "(string > 0)[] >= 1",
    archive: "string > 0",
    maxFiles: "number.integer > 0",
    maxBytes: "number.integer > 0",
  },
});
export type CommandAsk = typeof CommandAsk.infer;

// How an export ended: written; the first requested path that is missing; the first that is a
// link or passes through one; or too large for its limits.
const Exported = type({ "+": "reject", written: "true" })
  .or({ "+": "reject", missing: "string" })
  .or({ "+": "reject", link: "string" })
  .or({ "+": "reject", tooLarge: "true" });
type Exported = typeof Exported.infer;

export const CommandReport = type({
  "+": "reject",
  step: "number.integer >= 0 | null",
  exitCode: "number.integer | null",
  output: "string",
  timedOut: "boolean",
  "exported?": Exported,
}).or({ "+": "reject", error: "string" });
export type CommandReport = typeof CommandReport.infer;

// How much of a command's output the report keeps, from its end.
export const OUTPUT_TAIL_CHARS = 4096;
// What the sandbox may return of one command before it is stopped.
const OUTPUT_LIMIT_BYTES = 4 * 1024 * 1024;

// The shell lines a command runs, in order: a program and its arguments quoted so none is read as
// shell syntax, or a project's own lines as written.
const commandLines = (command: CommandAsk["command"]) =>
  "lines" in command
    ? command.lines
    : [command.setup, command.run]
        .filter((argv) => argv !== undefined)
        .map((argv) => argv.map(quote).join(" "));

// How deep a requested folder is walked. A build's output is a few levels deep, and a folder nested
// deeper than this was made to exhaust the walk.
const MAX_EXPORT_DEPTH = 32;

// Packs the requested paths of the workspace into a zip at archive. Each sandbox call ends by
// killing what it started, so nothing the build left running changes the workspace meanwhile. On
// macOS a process that left its process group could, and O_NOFOLLOW plus a check of every folder
// before it is read narrow that window. Links are never followed, so nothing outside the workspace
// is packed. A requested path that is a link or under one is refused. A link inside a requested
// folder is left out, as are sockets and other special files. Folders count toward maxFiles like
// files, because each is an entry in the zip.
async function exportPaths(
  workspace: string,
  { paths, archive, maxFiles, maxBytes }: NonNullable<CommandAsk["export"]>,
): Promise<Exported> {
  const root = await realpath(workspace);
  const zip = new JSZip();
  const packed = new Set<string>();
  let entries = 0;
  let bytes = 0;
  const pack = async (full: string, name: string) => {
    if (packed.has(name)) return true;
    // A file swapped for a link since the folder was read is refused, not followed. O_NONBLOCK
    // keeps a file swapped for a pipe from blocking the open while it waits for a writer.
    const file = await open(
      full,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    try {
      const stat = await file.stat();
      if (!stat.isFile()) return true;
      bytes += stat.size;
      if (++entries > maxFiles || bytes > maxBytes) return false;
      zip.file(name, await file.readFile());
      packed.add(name);
      return true;
    } finally {
      await file.close();
    }
  };
  // False once the walk goes past its limits. A folder swapped for a link since its parent was read
  // is left out, like a link found while reading.
  const walk = async (
    dir: string,
    name: string,
    depth: number,
  ): Promise<boolean> => {
    if (depth > MAX_EXPORT_DEPTH || ++entries > maxFiles) return false;
    if ((await realpath(dir)) !== dir) return true;
    zip.folder(name);
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      const inner = `${name}/${entry.name}`;
      if (entry.isDirectory()) {
        if (!(await walk(full, inner, depth + 1))) return false;
      } else if (entry.isFile() && !(await pack(full, inner))) return false;
    }
    return true;
  };
  for (const path of paths) {
    const full = join(root, path);
    let resolved;
    try {
      resolved = await realpath(full);
    } catch (error) {
      if (hasCode(error) && error.code === "ENOENT") return { missing: path };
      throw error;
    }
    if (resolved !== full) return { link: path };
    const found = await lstat(full);
    // Sockets and pipes are not build output.
    if (!found.isDirectory() && !found.isFile()) return { missing: path };
    const fits = found.isDirectory()
      ? await walk(full, path, 0)
      : await pack(full, path);
    if (!fits) return { tooLarge: true };
  }
  await writeFile(
    archive,
    await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" }),
  );
  return { written: true };
}

async function runCommand(
  workspace: string,
  ask: CommandAsk,
  signal: AbortSignal,
): Promise<CommandReport> {
  const deadline = Date.now() + ask.timeoutMs;
  const left = () => Math.max(1, deadline - Date.now());
  await writeBundle(workspace, bundleFiles(ask.bundle));
  const executor = await createPosixBuildExecutor(
    workspace,
    {
      commandTimeoutMs: ask.timeoutMs + 10_000,
      maxToolResultBytes: OUTPUT_LIMIT_BYTES,
    },
    await buildPackageLayout(),
    { openNetwork: ask.openNetwork, toolchains: ask.toolchains },
  );
  const shown = (step: number, ran: SandboxCommand) => ({
    step,
    exitCode: ran.exitCode,
    output: ran.output
      .replaceAll(workspace + sep, "")
      .slice(-OUTPUT_TAIL_CHARS),
    timedOut: ran.timedOut,
  });
  const lines = commandLines(ask.command);
  try {
    for (const [step, line] of lines.entries()) {
      const ran = await runInSandbox(executor, line, left(), signal);
      if (ran.exitCode !== 0) return shown(step, ran);
      if (step < lines.length - 1) continue;
      if (!ask.export) return shown(step, ran);
      return {
        ...shown(step, ran),
        exported: await exportPaths(workspace, ask.export),
      };
    }
    throw new Error("a command check runs at least one command");
  } finally {
    await executor.dispose();
  }
}

if (import.meta.main) {
  const stopping = new AbortController();
  process.once("SIGTERM", () => stopping.abort(new Error("stopped")));
  let report: CommandReport;
  try {
    const workspace = process.argv[2];
    if (!workspace) throw new Error("command_workspace_required");
    const ask = CommandAsk.assert(JSON.parse(await Bun.stdin.text()));
    report = await runCommand(workspace, ask, stopping.signal);
  } catch (error) {
    report = { error: error instanceof Error ? error.message : String(error) };
  }
  process.stdout.write(JSON.stringify(report) + "\n");
  process.exit("error" in report ? 1 : 0);
}
