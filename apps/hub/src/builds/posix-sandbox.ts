import { watch, type FSWatcher } from "node:fs";
import {
  chmod,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { isIP } from "node:net";
import { homedir, tmpdir } from "node:os";
import {
  SandboxManager,
  SandboxRuntimeConfigSchema,
} from "@anthropic-ai/sandbox-runtime";
import { type } from "arktype";
import { getLogger } from "@intx/log";
import { hasCode } from "@intx/types/has-code";
import type { ToolCall, ToolResult } from "@intx/types/runtime";
import { requestErrorMetadata } from "../request-error.ts";
import type { buildPackageLayout } from "./package-layout.ts";
import { BROWSER_ARGS } from "./browser.ts";
import { CODER_REGISTRY_HOSTS } from "../config/packages.ts";

const log = getLogger(["corbits-builder", "hub", "posix-sandbox"]);

export type BuildPackageLayout = Awaited<ReturnType<typeof buildPackageLayout>>;
// The workspace's dev app: its address, whether it runs and its recent output. stopped names the
// workspace whose dev script exited while the rest kept running, as `bun --filter` names it.
export type DevApp = {
  url: string;
  running: boolean;
  log: string[];
  stopped?: string;
};

export interface BuildExecutionPolicy {
  commandTimeoutMs: number;
  maxToolResultBytes: number;
}
export class BuildExecutionError extends Error {}
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
// `bun --filter`'s line when one workspace's script ends: "@app/server dev: Exited with code 1".
const PART_EXITED = /^(\S+) \S+: Exited with code \d+$/;
const PART_LINE = /^(\S+) \S+: (.*)$/;
// Changes the app makes itself, or that a restart would not pick up.
export const IGNORED_CHANGES =
  /(^|[/\\])(node_modules|\.git|dist|\.builder)([/\\]|$)/;
// A line the dev app prints when something broke: Bun's "error: …", a thrown TypeError, Vite's
// "Internal server error" or "Pre-transform error", or a workspace's dev script exiting.
const COMPLAINT =
  /(^|[\s\]])(\w*Error|error|Uncaught|Unhandled)\b|Exited with code [1-9]/;
// Bun prints the source lines and a caret before its error, then the frame after it.
const SOURCE_LINE = /^\s*(\d+ \||\^)/;
const FRAME = /^\s*at\s/;
// Node's own frames, and the bare "Error" Vite prints before them, locate nothing in the app.
const RUNTIME_FRAME = /\((internal|node):/;
const BARE_ERROR = /^\s*\w*Error:?\s*$/;
// Vite stamps its own lines with the time of day.
const TIME_OF_DAY = /^\d{1,2}:\d{2}:\d{2}\s*([AP]M)?\s*/;
const MAX_COMPLAINTS = 5;
// Several installs in a row restart the app once, then at most this often.
const RESTART_COOLDOWN_MS = 5_000;
const PageError = type({ detail: "string" });
// The macOS sandbox profile has no mach-lookup for com.apple.FSEvents, so Vite's watcher never
// hears a write, and chokidar keeps FSEvents even under CHOKIDAR_USEPOLLING. The starter's Vite
// config polls when given WATCH_POLL_MS, which stays inside the read policy; bun --watch uses
// kqueue and needs neither.
const MACOS_WATCH_POLLING = { WATCH_POLL_MS: "300" };
const SANDBOX_RUNTIME_VERSION = "0.0.81";
// srt's manager is process-global. A second job must use another sidecar
// process; it cannot silently replace the policy protecting a running job.
let leased = false;
// What bun, sh, curl, unzip and Chrome's headless shell load to run; nothing here holds user data.
const SYSTEM_READ_PATHS =
  process.platform === "darwin"
    ? [
        "/usr",
        "/bin",
        "/sbin",
        "/System",
        "/dev",
        // The /etc, /tmp and /var links alone, so paths through them resolve; Bun's WebView fails
        // to start Chrome without /tmp. /bin/sh reads which shell it is from select.
        "/etc",
        "/tmp",
        "/var",
        "/private/var/select/sh",
        "/private/etc/ssl",
        "/private/etc/hosts",
        "/private/etc/localtime",
        "/private/etc/resolv.conf",
        "/private/var/run/resolv.conf",
        "/private/var/db/timezone",
      ]
    : [
        "/usr",
        "/bin",
        "/sbin",
        "/lib",
        "/lib64",
        "/etc",
        "/dev",
        "/proc",
        "/sys",
      ];

// srt asks with the host as the client spelled it but dials its canonical form, and checks resolved
// addresses only for names, never for IP literals or localhost. So a host passes only when its
// canonical form, as WHATWG URL parsing gives it (127.1, 2130706433 and 0x7f.1 are all 127.0.0.1),
// is a public name.
export function publicHostName(host: string): boolean {
  let name: string;
  try {
    name = new URL(`http://${host}/`).hostname.toLowerCase().replace(/\.$/, "");
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    return false;
  }
  return (
    name.length > 0 &&
    !name.startsWith("[") &&
    isIP(name) === 0 &&
    name !== "localhost" &&
    !name.endsWith(".localhost")
  );
}

// macOS answers EPERM, not ESRCH, when every member of the group is an unreaped zombie.
function isGroupGone(error: unknown) {
  return hasCode(error) && (error.code === "ESRCH" || error.code === "EPERM");
}

// Playwright launches Chrome with its own sandbox off; the macOS sandbox profile lets no process
// register Mach services, so Chrome also runs as one process, as check-app runs it.
const BROWSER_CONFIG = JSON.stringify({
  browser: { launchOptions: { args: ["--single-process", "--no-zygote"] } },
});

async function freePort(): Promise<number> {
  const probe = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => new Response(),
  });
  const port = probe.port;
  await probe.stop(true);
  if (port === undefined)
    throw new BuildExecutionError("sandbox_port_unavailable");
  return port;
}

export async function createPosixBuildExecutor(
  workspace: string,
  limits: BuildExecutionPolicy,
  layout: BuildPackageLayout,
  options: {
    openNetwork?: boolean;
    // Extra commands on PATH, each a Bun script kept beside the shims where the sandbox cannot write.
    commands?: Readonly<Record<string, string>>;
    // Workspace folders the agent reads but never writes, such as the coder's copy of the design.
    readOnly?: readonly string[];
    // A Bun script that keeps the dev app's page open and prints each error it meets as a JSON line.
    pageWatcher?: string;
    // Whether the agent drives its app in Playwright's browser, which browser() starts.
    browser?: boolean;
    // The shared Chrome install, which the sandbox reads through $HOME/browsers but never writes.
    browsers?: string | undefined;
  } = {},
) {
  if (leased) throw new BuildExecutionError("sandbox_already_leased");
  for (const value of [limits.commandTimeoutMs, limits.maxToolResultBytes])
    if (!Number.isSafeInteger(value) || value <= 0)
      throw new BuildExecutionError(
        "explicit_positive_execution_limits_required",
      );
  leased = true;
  let initialized = false;
  let shimDirectory: string | undefined;
  let sockets: string | undefined;
  let stage = "workspace";
  try {
    const cwd = await realpath(workspace);
    stage = "dependencies";
    const contains = (parent: string, path: string) => {
      const tail = relative(parent, path);
      return tail === "" || (tail !== ".." && !tail.startsWith(`..${sep}`));
    };
    const protectedPaths = [
      layout.assetDirectory,
      layout.childPath,
      ...layout.dependencyRoots,
    ];
    if (
      cwd === homedir() ||
      cwd === "/" ||
      protectedPaths.some((path) => contains(cwd, path) || contains(path, cwd))
    )
      throw new BuildExecutionError("owned_build_workspace_required");
    const executable = await realpath(process.execPath);
    // Standard `#!/usr/bin/env node` launchers must resolve inside the sandbox,
    // which has no Node; a hub-owned shim on PATH runs them with Bun instead.
    shimDirectory = await realpath(
      await mkdtemp(join(tmpdir(), "sb-node-shim-")),
    );
    const nodeShim = join(shimDirectory, "node");
    await writeFile(nodeShim, `#!/bin/sh\nexec ${quote(executable)} "$@"\n`);
    await chmod(nodeShim, 0o755);
    // An agent that can read check-app's source reads it instead of its own work. Each command is
    // compiled to an executable, which macOS runs with its reads denied (Seatbelt checks
    // process-exec apart from file-read*), so the source never sits where the agent can read it.
    // The denial covers metadata too, which a PATH lookup needs, so a readable shim execs it by its
    // path. A Linux sandbox masks a read-denied file, so there the executable stays readable.
    const executables = Object.keys(options.commands ?? {}).map((name) =>
      join(shimDirectory!, `${name}.bin`),
    );
    for (const [name, source] of Object.entries(options.commands ?? {})) {
      const entry = `/${name}.ts`;
      const binary = join(shimDirectory, `${name}.bin`);
      const built = await Bun.build({
        entrypoints: [entry],
        files: { [entry]: source },
        target: "bun",
        minify: true,
        compile: {
          outfile: binary,
          executablePath: executable,
          autoloadDotenv: false,
          autoloadBunfig: false,
        },
      });
      if (!built.success)
        throw new BuildExecutionError(
          `command_build_failed:${name} ${built.logs.join("; ")}`,
        );
      const shim = join(shimDirectory, name);
      // srt points TMPDIR at a folder it does not make inside the sandbox's own /tmp, and Bun's
      // WebView cannot start Chrome without a temp folder.
      await writeFile(
        shim,
        `#!/bin/sh\n[ -z "$TMPDIR" ] || mkdir -p -- "$TMPDIR"\nexec ${quote(binary)} "$@"\n`,
      );
      await chmod(shim, 0o755);
    }
    const pageWatcher = join(shimDirectory, "watch-page.ts");
    if (options.pageWatcher) await writeFile(pageWatcher, options.pageWatcher);
    const rg = layout.ripgrepPath;
    if (layout.runtimeVersion !== SANDBOX_RUNTIME_VERSION)
      throw new BuildExecutionError(
        `sandbox_unavailable:runtime_version ${layout.runtimeVersion}`,
      );
    if (!SandboxManager.isSupportedPlatform())
      throw new BuildExecutionError(
        `sandbox_unavailable:platform ${process.platform}`,
      );
    const dependencies = SandboxManager.checkDependencies({ command: rg });
    if (dependencies.errors.length)
      throw new BuildExecutionError(
        `sandbox_unavailable:dependencies ${dependencies.errors.join("; ")}`,
      );
    // Bun's install cache and Library go to HOME; keeping that beside the
    // workspace leaves the app tree holding only what the coder wrote.
    const home = join(dirname(cwd), "home");
    await mkdir(home, { recursive: true });
    // A home set up before the install was shared holds its own copy of Chrome here.
    await rm(join(home, "browsers"), { recursive: true, force: true });
    if (options.browsers)
      await symlink(options.browsers, join(home, "browsers"));
    // Playwright's MCP server always serves its browser on a Unix socket, which the sandbox allows
    // only here. Under /tmp, as a socket's path fits in 104 bytes on macOS.
    if (options.browser)
      sockets = await realpath(await mkdtemp("/tmp/sb-browser-"));
    stage = "policy";
    const policy = SandboxRuntimeConfigSchema.parse({
      filesystem: {
        // Reads are default-deny: the host's homes, projects, hub data and other workspaces stay
        // hidden, and only the system runtime and this job's own trees are re-opened.
        denyRead: [
          "/",
          "**/.env",
          "**/.env.*",
          ...(process.platform === "darwin" ? executables : []),
        ],
        allowRead: [
          ...SYSTEM_READ_PATHS,
          cwd,
          executable,
          shimDirectory,
          ...layout.dependencyRoots,
          // Bun lists the entry module's directory before loading it.
          layout.assetDirectory,
          home,
          ...(options.browsers ? [options.browsers] : []),
          ...(sockets ? [sockets] : []),
        ],
        allowWrite: [cwd, home, ...(sockets ? [sockets] : [])],
        denyWrite: [
          ...protectedPaths,
          shimDirectory,
          ...(options.readOnly ?? []).map((path) => join(cwd, path)),
        ],
      },
      network: {
        allowedDomains: options.openNetwork ? [] : [...CODER_REGISTRY_HOSTS],
        deniedDomains: [],
        allowUnixSockets: sockets ? [sockets] : [],
        // A Linux sandbox filters Unix sockets by syscall, not by path.
        ...(sockets && process.platform === "linux"
          ? { allowAllUnixSockets: true }
          : {}),
        allowLocalBinding: true,
        // Resolved names in private and carrier-grade NAT space (a LAN, a tailnet) are refused too.
        deniedResolvedAddresses: [
          "10.0.0.0/8",
          "172.16.0.0/12",
          "192.168.0.0/16",
          "100.64.0.0/10",
          "fc00::/7",
        ],
      },
      mandatoryDenySearchDepth: 5,
      ripgrep: { command: rg },
    });
    stage = "initialize";
    // srt rejects a bare "*" allow entry, so its ask callback opens the network.
    await SandboxManager.initialize(
      policy,
      options.openNetwork
        ? async ({ host }) => publicHostName(host)
        : undefined,
    );
    initialized = true;
    // On Linux srt relays the sandbox's proxy ports to the host over Unix sockets in the host's temp
    // folder, which the default-deny read policy hides; srt binds them before that deny lands, so
    // every connection through the proxy was reset. Named in allowRead, they are bound back over it.
    if (process.platform === "linux") {
      await SandboxManager.waitForNetworkInitialization();
      const bridges = new Set(
        [
          SandboxManager.getLinuxHttpSocketPath(),
          SandboxManager.getLinuxSocksSocketPath(),
        ].filter((path): path is string => path !== undefined),
      );
      if (bridges.size)
        SandboxManager.updateConfig({
          ...policy,
          filesystem: {
            ...policy.filesystem,
            allowRead: [...(policy.filesystem.allowRead ?? []), ...bridges],
          },
        });
    }
    stage = "wrap";
    // The child resolves the workspace packages from source like the hub does;
    // the vendored packages ship no built dist.
    const childCommand = `exec ${[executable, "--no-env-file", "--conditions=intx-src", layout.childPath, cwd].map(quote).join(" ")}`;
    const wrapped = await SandboxManager.wrapWithSandbox(
      childCommand,
      "/bin/sh",
    );
    let trustedGate: { nonce: string; timeoutMs: number } | undefined;
    let devApp:
      | {
          process: Bun.Subprocess<"ignore", "pipe", "pipe">;
          view: () => DevApp;
          watcher?: FSWatcher;
          page?: Bun.Subprocess<"pipe", "pipe", "ignore">;
        }
      | undefined;
    // What the running app complained of since the agent last heard, each once and newest last.
    const complaints = new Set<string>();
    const complain = (text: string) => {
      const cleaned = text
        .replaceAll(cwd + sep, "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 300);
      complaints.delete(cleaned);
      complaints.add(cleaned);
      if (complaints.size > MAX_COMPLAINTS)
        complaints.delete(complaints.values().next().value!);
      return cleaned;
    };
    const kill = (child: Bun.Subprocess) => {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch (error) {
        if (!isGroupGone(error)) throw error;
        child.kill("SIGKILL");
      }
    };
    const childEnv = {
      PATH: `${shimDirectory}:${dirname(executable)}:/usr/local/bin:/usr/bin:/bin`,
      HOME: home,
      TMPDIR: home,
      NO_COLOR: "1",
    };
    let browser: { process: Bun.Subprocess; url: string } | undefined;
    let browserStarting: Promise<string> | undefined;
    // A turn's tool calls run in parallel; two app_status calls must not each start a server.
    let devAppStarting: Promise<DevApp> | undefined;
    let restarting: Promise<DevApp> | undefined;
    let restartedAt = 0;
    const commands = new Set<Bun.Subprocess>();
    let disposed = false;
    let running = false;
    // Interchange runs a turn's tool calls concurrently (INFERENCE.md "Parallel
    // execution"); the sandbox holds one child at a time, so calls queue here.
    let queue: Promise<unknown> = Promise.resolve();
    const execute = async (
      call: ToolCall,
      signal: AbortSignal,
    ): Promise<ToolResult> => {
      if (disposed) throw new BuildExecutionError("sandbox_closed");
      signal.throwIfAborted();
      // SRT's Linux wrapper supports exec composition. The namespace owner
      // must be a direct child in the workflow group, so parent death and the
      // native spawner's group cleanup also reach an interrupted tool.
      const linux = process.platform === "linux";
      const gateWrapped = trustedGate
        ? await SandboxManager.wrapWithSandbox(
            childCommand,
            "/bin/sh",
            {
              filesystem: {
                ...policy.filesystem,
                allowWrite: [],
                denyWrite: [...protectedPaths, cwd],
              },
            },
            signal,
          )
        : wrapped;
      const child = Bun.spawn(
        ["/bin/sh", "-c", linux ? `exec ${gateWrapped}` : gateWrapped],
        {
          cwd,
          env: childEnv,
          stdin: "pipe",
          stdout: "pipe",
          stderr: "pipe",
          detached: !linux,
        },
      );
      running = true;
      const stop = () => {
        if (linux) {
          // Killing the namespace owner terminates its complete PID namespace;
          // signaling its inherited group would also kill the workflow host.
          child.kill("SIGKILL");
          return;
        }
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch (error) {
          if (!isGroupGone(error)) throw error;
          child.kill("SIGKILL");
        }
      };
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        stop();
      }, trustedGate?.timeoutMs ?? limits.commandTimeoutMs);
      signal.addEventListener("abort", stop, { once: true });
      try {
        child.stdin.write(JSON.stringify(call));
        await child.stdin.end();
        // Drained concurrently so a chatty failing child cannot fill the
        // pipe and block before its own exit status is observed.
        const diagnostics = new Response(child.stderr).text();
        const reader = child.stdout.getReader();
        const chunks: Uint8Array[] = [];
        let length = 0;
        try {
          while (true) {
            const next = await reader.read();
            if (next.done) break;
            length += next.value.length;
            if (length > limits.maxToolResultBytes) {
              stop();
              throw new BuildExecutionError("tool_output_limit_exceeded");
            }
            chunks.push(next.value);
          }
        } finally {
          reader.releaseLock();
        }
        const code = await child.exited;
        signal.throwIfAborted();
        if (timedOut) throw new BuildExecutionError("tool_deadline_exceeded");
        if (code !== 0)
          throw new BuildExecutionError(
            // A discarded stderr makes a sandbox refusal indistinguishable
            // from a broken child bundle; surface its tail.
            `sandbox_tool_process_failed: ${(await diagnostics).slice(-2000)}`,
          );
        const result = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        if (
          result.callId !== call.id ||
          typeof result.content !== "string" ||
          (result.isError !== undefined && typeof result.isError !== "boolean")
        )
          throw new BuildExecutionError("invalid_native_tool_result");
        return result as ToolResult;
      } finally {
        clearTimeout(timer);
        signal.removeEventListener("abort", stop);
        stop();
        await child.exited;
        running = false;
      }
    };
    const stopApp = async () => {
      if (!devApp) return;
      const { process: child, watcher, page } = devApp;
      watcher?.close();
      devApp = undefined;
      kill(child);
      if (page) kill(page);
      await Promise.all([child.exited, page?.exited]);
    };
    const startApp = (): Promise<DevApp> => {
      if (disposed)
        return Promise.reject(new BuildExecutionError("sandbox_closed"));
      if (
        devApp &&
        devApp.process.exitCode === null &&
        devApp.view().stopped === undefined
      )
        return Promise.resolve(devApp.view());
      const launchDevApp = async () => {
        try {
          await stopApp();
          const [port, clientPort] = await Promise.all([
            freePort(),
            freePort(),
          ]);
          const command = await SandboxManager.wrapWithSandbox(
            `exec ${quote(executable)} run dev`,
            "/bin/sh",
          );
          const child = Bun.spawn(["/bin/sh", "-c", command], {
            cwd,
            env: {
              ...childEnv,
              PORT: String(port),
              CLIENT_PORT: String(clientPort),
              ...(process.platform === "darwin" ? MACOS_WATCH_POLLING : {}),
            },
            stdin: "ignore",
            stdout: "pipe",
            stderr: "pipe",
            detached: process.platform !== "linux",
          });
          const lines: string[] = [];
          let stopped: string | undefined;
          const current = () => !disposed && devApp?.process === child;
          // `bun --filter` keeps the other half running when one exits, so the dev server still
          // answers while its API is gone. The next file change starts the whole app again.
          const restartAfterChange = async () => {
            try {
              await startApp();
            } catch (error) {
              log.warn(
                "Restarting the dev app after a file change failed",
                requestErrorMetadata(error),
              );
            }
          };
          const partStopped = (name: string) => {
            stopped = name;
            if (!devApp || !current()) return;
            devApp.watcher = watch(cwd, { recursive: true }, (_event, file) => {
              if (file === null || IGNORED_CHANGES.test(file) || !current())
                return;
              void restartAfterChange();
            });
          };
          const collect = async (stream: ReadableStream<Uint8Array>) => {
            const decoder = new TextDecoder();
            // The last complaint on this stream, which the frame on the next line locates.
            let complaint: string | undefined;
            for await (const chunk of stream)
              for (const line of decoder
                .decode(chunk, { stream: true })
                .split("\n")) {
                if (!line.trim()) continue;
                if (lines.push(line) > 200) lines.shift();
                const exited = PART_EXITED.exec(line);
                if (exited && stopped === undefined) partStopped(exited[1]!);
                if (!current()) continue;
                const match = PART_LINE.exec(line);
                const part = match?.[1] ?? "app";
                const said = match?.[2] ?? line;
                const text = said.replace(TIME_OF_DAY, "");
                if (FRAME.test(text)) {
                  if (complaint && !RUNTIME_FRAME.test(text)) {
                    complaints.delete(complaint);
                    complain(`${complaint} (${text.trim()})`);
                  }
                  complaint = undefined;
                } else
                  complaint =
                    COMPLAINT.test(text) &&
                    !SOURCE_LINE.test(text) &&
                    !BARE_ERROR.test(text)
                      ? complain(`${part}: ${text}`)
                      : undefined;
              }
          };
          void Promise.all([collect(child.stdout), collect(child.stderr)]);
          // Vite serves the client on CLIENT_PORT and proxies /api to the server on PORT.
          const url = `http://127.0.0.1:${clientPort}`;
          const view = (): DevApp => ({
            url,
            running: child.exitCode === null,
            log: lines.slice(-40),
            ...(stopped === undefined ? {} : { stopped }),
          });
          devApp = { process: child, view };
          if (options.pageWatcher) {
            const page = Bun.spawn(
              [
                "/bin/sh",
                "-c",
                await SandboxManager.wrapWithSandbox(
                  `exec ${[executable, "--no-env-file", pageWatcher, url].map(quote).join(" ")}`,
                  "/bin/sh",
                ),
              ],
              {
                cwd,
                env: childEnv,
                stdin: "pipe",
                stdout: "pipe",
                stderr: "ignore",
                detached: process.platform !== "linux",
              },
            );
            devApp.page = page;
            async function readPageReports() {
              const decoder = new TextDecoder();
              try {
                for await (const chunk of page.stdout)
                  for (const line of decoder
                    .decode(chunk, { stream: true })
                    .split("\n")) {
                    if (!line.trim() || !current()) continue;
                    let parsed: unknown;
                    try {
                      parsed = JSON.parse(line);
                    } catch (error) {
                      if (error instanceof SyntaxError) continue;
                      throw error;
                    }
                    const report = PageError(parsed);
                    if (!(report instanceof type.errors))
                      complain(`page: ${report.detail}`);
                  }
              } catch (error) {
                log.warn(
                  "Reading the page watcher's output failed",
                  requestErrorMetadata(error),
                );
              }
            }
            void readPageReports();
          }
          return view();
        } finally {
          devAppStarting = undefined;
        }
      };
      devAppStarting ??= launchDevApp();
      return devAppStarting;
    };
    // Playwright's MCP server for the coder's browser, under the same sandbox as its app and driving
    // the shared Chrome under $HOME/browsers.
    const startBrowser = (): Promise<string> => {
      if (disposed)
        return Promise.reject(new BuildExecutionError("sandbox_closed"));
      if (!sockets)
        return Promise.reject(
          new BuildExecutionError("browser_not_provisioned"),
        );
      if (browser && browser.process.exitCode === null)
        return Promise.resolve(browser.url);
      browserStarting ??= (async () => {
        const [chrome] = await Array.fromAsync(
          new Bun.Glob("chrome-headless-shell-*/chrome-headless-shell").scan({
            cwd: join(home, "browsers"),
            absolute: true,
          }),
        );
        if (!chrome)
          throw new BuildExecutionError(
            "browser_unavailable: nothing under $HOME/browsers",
          );
        const config = join(shimDirectory!, "browser.json");
        await writeFile(config, BROWSER_CONFIG);
        const port = await freePort();
        const argv = [
          executable,
          "--no-env-file",
          layout.browserCli,
          ...BROWSER_ARGS,
          "--port",
          String(port),
          "--executable-path",
          chrome,
          "--config",
          config,
          "--output-dir",
          join(home, "browser"),
        ];
        const child = Bun.spawn(
          [
            "/bin/sh",
            "-c",
            await SandboxManager.wrapWithSandbox(
              `exec ${argv.map(quote).join(" ")}`,
              "/bin/sh",
            ),
          ],
          {
            cwd,
            env: { ...childEnv, PWTEST_SOCKETS_DIR: sockets },
            stdin: "ignore",
            stdout: "ignore",
            stderr: "pipe",
            detached: process.platform !== "linux",
          },
        );
        const diagnostics = new Response(child.stderr).text();
        browser = { process: child, url: `http://127.0.0.1:${port}/mcp` };
        const deadline = Date.now() + 30_000;
        while (
          !(await fetch(browser.url).then(
            () => true,
            () => false,
          ))
        ) {
          if (child.exitCode !== null || disposed || Date.now() > deadline) {
            kill(child);
            throw new BuildExecutionError(
              `browser_unavailable: ${(await diagnostics).slice(-2000)}`,
            );
          }
          await Bun.sleep(250);
        }
        return browser.url;
      })().finally(() => (browserStarting = undefined));
      return browserStarting;
    };
    return {
      policy,
      version: SANDBOX_RUNTIME_VERSION,
      run(call: ToolCall, signal: AbortSignal): Promise<ToolResult> {
        if (
          call.name === "__sb_host_gate" &&
          (!trustedGate || call.id !== trustedGate.nonce)
        )
          throw new BuildExecutionError("host_gate_invocation_refused");
        if (trustedGate && call.id !== trustedGate.nonce)
          throw new BuildExecutionError("concurrent_build_tool_refused");
        const turn = queue.then(() => execute(call, signal));
        queue = turn.catch(() => undefined);
        if (call.name === "write_file" || call.name === "edit_file")
          void turn
            .then(() => {
              const page = devApp?.page;
              if (page?.exitCode !== null) return;
              page.stdin.write("reload\n");
              return page.stdin.flush();
            })
            .catch(() => undefined);
        return turn;
      },
      /**
       * Runs one of the extra commands in the sandbox beside the agent's own calls, which keep their
       * queue, and resolves with its exit code and output once it ends or signal stops it.
       */
      async command(
        name: string,
        args: readonly string[],
        signal: AbortSignal,
      ) {
        if (disposed) throw new BuildExecutionError("sandbox_closed");
        if (options.commands?.[name] === undefined)
          throw new BuildExecutionError(`unknown_command: ${name}`);
        signal.throwIfAborted();
        const child = Bun.spawn(
          [
            "/bin/sh",
            "-c",
            await SandboxManager.wrapWithSandbox(
              `exec ${[join(shimDirectory!, name), ...args].map(quote).join(" ")}`,
              "/bin/sh",
            ),
          ],
          {
            cwd,
            env: childEnv,
            stdin: "ignore",
            stdout: "pipe",
            stderr: "pipe",
            detached: process.platform !== "linux",
          },
        );
        commands.add(child);
        const stop = () => kill(child);
        const timer = setTimeout(stop, limits.commandTimeoutMs);
        signal.addEventListener("abort", stop, { once: true });
        try {
          const [output, errors] = await Promise.all([
            new Response(child.stdout).text(),
            new Response(child.stderr).text(),
          ]);
          const exitCode = await child.exited;
          // A command that died before printing its checklist would otherwise fail with nothing said.
          const text =
            exitCode === 0
              ? output
              : [output, errors.slice(-2000)]
                  .filter((part) => part.trim())
                  .join("\n");
          return { exitCode, output: text.replaceAll(cwd + sep, "") };
        } finally {
          clearTimeout(timer);
          signal.removeEventListener("abort", stop);
          // Chrome may outlive the command that started it.
          stop();
          commands.delete(child);
        }
      },
      /** What the running app complained of since the last call: its server's errors and its page's. */
      reports() {
        const said = [...complaints];
        complaints.clear();
        return said;
      },
      async runGate(
        config: {
          command: { argv: string[]; cwd: string };
          limits: { timeoutMs: number; maxOutputBytes: number };
        },
        signal: AbortSignal,
      ) {
        if (trustedGate)
          throw new BuildExecutionError("concurrent_build_tool_refused");
        const nonce = crypto.randomUUID();
        trustedGate = { nonce, timeoutMs: config.limits.timeoutMs };
        try {
          const result = await this.run(
            {
              id: nonce,
              name: "__sb_host_gate",
              arguments: {
                nonce,
                argv: config.command.argv,
                cwd: config.command.cwd,
                ...config.limits,
              },
            },
            signal,
          );
          if (typeof result.content !== "string")
            throw new BuildExecutionError("host_gate_result_refused");
          const receipt = JSON.parse(result.content);
          if (
            receipt.nonce !== nonce ||
            typeof receipt.timedOut !== "boolean" ||
            typeof receipt.outputLimited !== "boolean" ||
            (receipt.exitCode !== null &&
              (!Number.isInteger(receipt.exitCode) ||
                receipt.exitCode < 0 ||
                receipt.exitCode > 255))
          )
            throw new BuildExecutionError("host_gate_result_refused");
          return receipt as {
            exitCode: number | null;
            timedOut: boolean;
            outputLimited: boolean;
            stdout: { sha256: string; bytes: number } | null;
            stderr: { sha256: string; bytes: number } | null;
          };
        } finally {
          trustedGate = undefined;
        }
      },
      violationCount: () =>
        SandboxManager.getSandboxViolationStore().getTotalCount(),
      /**
       * Starts `bun run dev` in the workspace under the same sandbox and keeps it running until
       * dispose, so the agent can use its app while it builds. Calling it again returns the same
       * app, restarted when it or one of its halves has exited.
       */
      app: startApp,
      /** The coder's browser server's URL, started on first use and again whenever it has exited. */
      browser: startBrowser,
      /** The app's address, state and recent output, or undefined until it is started. */
      appState: (): DevApp | undefined => devApp?.view(),
      /**
       * Starts the running app again so it loads packages installed since it started; calls within
       * the cooldown share one restart. Nothing happens when no app is running.
       */
      restartApp(): Promise<DevApp> | undefined {
        if (!devApp) return undefined;
        restarting ??= (async () => {
          await Bun.sleep(
            Math.max(0, restartedAt + RESTART_COOLDOWN_MS - Date.now()),
          );
          // An install that finishes from here on needs a restart of its own.
          restarting = undefined;
          restartedAt = Date.now();
          await stopApp();
          return startApp();
        })();
        return restarting;
      },
      async dispose() {
        if (running) throw new BuildExecutionError("build_tool_still_running");
        if (disposed) return;
        disposed = true;
        await stopApp();
        if (browser) kill(browser.process);
        for (const child of commands) kill(child);
        await Promise.all(
          [...commands, ...(browser ? [browser.process] : [])].map(
            (child) => child.exited,
          ),
        );
        try {
          await SandboxManager.reset();
        } finally {
          leased = false;
          await rm(shimDirectory!, { recursive: true, force: true });
          if (sockets) await rm(sockets, { recursive: true, force: true });
        }
      },
    };
  } catch (error) {
    if (initialized) await SandboxManager.reset();
    leased = false;
    if (shimDirectory)
      await rm(shimDirectory, { recursive: true, force: true });
    if (sockets) await rm(sockets, { recursive: true, force: true });
    if (
      error instanceof BuildExecutionError &&
      (error.message.startsWith("sandbox_unavailable:") ||
        error.message === "owned_build_workspace_required")
    )
      throw error;
    throw new BuildExecutionError(
      `sandbox_initialization_failed:${stage}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
