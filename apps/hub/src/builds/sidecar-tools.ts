import { defineTool, type BaseEnv } from "@intx/agent/authoring";
import { HUB_CREDENTIAL_HANDLE } from "@intx/types/credential-delivery";
import { readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { createPosixTools } from "@intx/tools-posix";
import { posix } from "@intx/tools-posix/sidecar-bundle";
import {
  createBlobReader,
  type ToolCall,
  type ToolResult,
  type ToolRunner,
} from "@intx/types/runtime";
import type { RuntimeCapabilities } from "@intx/types/runtime-capabilities";
import {
  resolveWorkflowProjectScope,
  WorkflowHttpError,
} from "@corbits-builder/tools-hub";
import { APP_STATUS_TOOL, createCodingTools } from "./coding-tools.ts";
import { createPosixBuildExecutor } from "./posix-sandbox.ts";
import { browserTools } from "./browser.ts";
import type { BrowserCatalog } from "./browser-catalog.ts";
import {
  CHECK_APP,
  WATCH_PAGE,
  prepareWorkspace,
  sharedBrowser,
} from "./starter.ts";
import {
  fileApp,
  readFiledDocument,
  readPreviousDesignDraft,
  readRunDesignTheme,
} from "./app-snapshot.ts";
import { INPUTS_DIRECTORY } from "../config/inputs.ts";
import {
  CHECK_PASSED,
  createAppRepository,
  EDIT,
  requestAppPushAccess,
  revokeAppPushAccess,
  signWithSidecarKey,
  type AppRepository,
} from "./app-repository.ts";
import { getLogger } from "@intx/log";
import { requestErrorMetadata } from "../request-error.ts";
import {
  PACKAGE_INSTALL_TOOL,
  WorkspacePath,
} from "@corbits-builder/schemas/package-install";
import { installedPackages } from "./package-install.ts";
import { undeclaredImports } from "./import-scan.ts";
import { typeProbe } from "./type-probe.ts";
import {
  CHECK_DESIGN_TOOL,
  checkDesignDefinition,
  createDesignCheck,
  DESIGNS,
  touchesDesigns,
  type DesignCheck,
} from "./design-check.ts";

// A model retries a refused absolute path verbatim until the doom guard ends the run, as with the
// workspace path with "/" typed for "-", or "/builder" meaning ".builder". Naming the workspace path
// it meant gives it something other than the same call to make.
export async function meant(workspace: string, path: string): Promise<string> {
  const tail = /\/workspace(?:\/(.*))?$/.exec(path);
  const stripped = path.replace(/^\/+/, "");
  const candidates = [
    tail ? (tail[1] ?? ".") : undefined,
    stripped,
    `.${stripped}`,
  ];
  for (const candidate of candidates) {
    if (candidate === undefined) continue;
    if (
      await stat(resolve(workspace, candidate)).then(
        () => true,
        () => false,
      )
    )
      return `use the relative path ${candidate}`;
  }
  return "a path relative to the workspace always works";
}

export interface CodingSidecarEnv extends BaseEnv {
  toolCwd: string;
  capabilities: RuntimeCapabilities;
}

const log = getLogger(["corbits-builder", "hub", "sidecar-coding-tools"]);
const CODER_EXECUTION = {
  commandTimeoutMs: 120_000,
  maxToolResultBytes: 256 * 1024,
};
// A backgrounded command never returns, so the agent hangs silently. A lone `&` (not `&&`, `2>&1`
// or `&>`), nohup, disown and setsid background.
const BACKGROUND = /(?<![&|>])&(?![&>])|\b(nohup|disown|setsid)\b/;
// Quoted text is data, such as a URL query string, so it is blanked before matching.
const backgrounds = (command: string) =>
  BACKGROUND.test(command.replace(/'[^']*'|"(?:\\.|[^"\\])*"/g, "''"));

const WRITES = new Set(["write_file", "edit_file"]);

// The underlying error's code and message, with what the hub said when it refused.
function filingFailure(error: unknown) {
  if (error instanceof WorkflowHttpError)
    return [
      error.message,
      error.refusalCode,
      error.hint,
      ...(error.issues ?? []).map((issue) => `${issue.path} ${issue.message}`),
    ]
      .filter(Boolean)
      .join(": ");
  return error instanceof Error
    ? `${error.name}: ${error.message}`
    : String(error);
}
// The designer writes HTML and CSS only, and check_design runs check-app for it; given a shell, a
// designer generates its mockup with scripts instead.
const DESIGNER_TOOLS = new Set([
  "read_file",
  "write_file",
  "edit_file",
  "grep",
]);
// The calls after which the agent hears what its running app complained of since the last one.
const REPORTING = new Set([...WRITES, PACKAGE_INSTALL_TOOL]);
// run_shell reports a failed command as its output, headed by its exit code.
const succeeded = (result: ToolResult) =>
  !result.isError && !String(result.content).startsWith("exit code ");

// The calls that can change the app's files.
const VERSIONED = new Set([...WRITES, "run_shell", PACKAGE_INSTALL_TOOL]);
// Bounds teardown: the wait for the last version, then the revoke.
const VERSION_CLOSE_MS = 15_000;
// An app-mode check-app pass; a mockup check in the same workspace passes without building anything.
const passedAppCheck = (call: ToolCall, result: ToolResult) =>
  call.name === "run_shell" &&
  /check-app/.test(String(call.arguments["command"])) &&
  typeof result.content === "string" &&
  /check passed: built, started,/.test(result.content);

// A cold install; under the executor's own ceiling.
const SETUP_TIMEOUT_MS = 115_000;

// A source-closure-safe declaration: only explicit policy is captured. The
// native child supplies the step workspace; the sandbox is built inside it.
export function createSidecarCodingTools(policy: {
  approval: "ask" | "allow";
  workspace: "app" | "design";
  packageInstall?: "ask" | "allow";
  browser?: BrowserCatalog;
}) {
  if (!["ask", "allow"].includes(policy.approval))
    throw new Error("invalid_coding_policy");
  const design = policy.workspace === "design";
  const offered = (name: string) => !design || DESIGNER_TOOLS.has(name);
  return defineTool<CodingSidecarEnv>({
    id: "@corbits-builder/coding/sidecar-posix",
    credentials: [{ handle: HUB_CREDENTIAL_HANDLE }],
    requires: ["toolCwd", "capabilities"],
    definitions: [
      ...posix.definitions
        .filter((tool) => offered(tool.name))
        .map((tool) =>
          policy.approval === "ask"
            ? { name: tool.name, approval: "ask" as const }
            : { name: tool.name },
        ),
      ...(policy.packageInstall
        ? [
            policy.packageInstall === "ask"
              ? { name: PACKAGE_INSTALL_TOOL, approval: "ask" as const }
              : { name: PACKAGE_INSTALL_TOOL },
          ]
        : []),
      ...(policy.workspace === "app" ? [{ name: APP_STATUS_TOOL }] : []),
      ...(design ? [{ name: CHECK_DESIGN_TOOL }] : []),
      ...(policy.browser?.definitions ?? []),
    ],
    factory: (env) => {
      let sandbox: ReturnType<typeof createPosixBuildExecutor> | undefined;
      let spilled: ReturnType<typeof createPosixTools> | undefined;
      // The coder learns whether its passing app reached the person; a failure leaves the build
      // going but is never silent.
      const fileCheckedApp = async (workspace: string, signal: AbortSignal) => {
        try {
          const scope = await resolveWorkflowProjectScope(
            env.capabilities,
            "coder",
            signal,
          );
          const version = await fileApp(
            env.capabilities,
            scope,
            workspace,
            signal,
          );
          return `The app is filed as version ${version}.`;
        } catch (error) {
          const reason = filingFailure(error);
          log.error("Filing the app failed: {reason}", {
            reason,
            ...requestErrorMetadata(error),
          });
          return `The app was not filed: ${reason}.`;
        }
      };
      let designCheck: DesignCheck | undefined;
      // The project's app repository, once the workspace is prepared. Every call that can change
      // files versions the workspace in the background; the builder never waits on a push.
      let repository: AppRepository | undefined;
      // The same repository from the start of setup, so teardown during setup still closes it.
      let opened: AppRepository | undefined;
      let browser:
        | {
            url: string;
            tools: Promise<
              ReturnType<Awaited<ReturnType<typeof browserTools>>>
            >;
          }
        | undefined;
      const open = (signal: AbortSignal) => {
        const role = policy.workspace === "app" ? "coder" : "designer";
        sandbox ??= resolveWorkflowProjectScope(
          env.capabilities,
          role,
          signal,
        ).then(async (scope) => {
          const workspace = await realpath(env.toolCwd);
          const app =
            policy.workspace === "app"
              ? (opened ??= createAppRepository({
                  workspace,
                  access: (signal) =>
                    requestAppPushAccess(env.capabilities, scope, signal),
                  revoke: (signal) =>
                    revokeAppPushAccess(env.capabilities, scope, signal),
                  sign: signWithSidecarKey,
                }))
              : undefined;
          const setup = await prepareWorkspace(
            policy.workspace,
            workspace,
            (kind) => readFiledDocument(env.capabilities, scope, kind, signal),
            () => readRunDesignTheme(env.capabilities, scope, signal),
            () => readPreviousDesignDraft(env.capabilities, scope, signal),
            app && { repository: app, signal },
          );
          repository = app;
          repository?.schedule("Start");
          const executor = await createPosixBuildExecutor(
            workspace,
            CODER_EXECUTION,
            scope.build,
            {
              openNetwork: scope.openNetwork,
              commands: { "check-app": CHECK_APP },
              browser: policy.browser !== undefined,
              browsers: await sharedBrowser(),
              ...(policy.workspace === "app"
                ? {
                    readOnly: [".builder", INPUTS_DIRECTORY],
                    pageWatcher: WATCH_PAGE,
                  }
                : { readOnly: [INPUTS_DIRECTORY] }),
            },
          );
          try {
            if (setup) {
              const result = await executor.run(
                {
                  id: "workspace-setup",
                  name: "run_shell",
                  arguments: {
                    command: setup.command,
                    timeout: SETUP_TIMEOUT_MS,
                  },
                },
                signal,
              );
              if (!succeeded(result))
                throw new Error(
                  `workspace_setup_failed: ${String(result.content).slice(-2000)}`,
                );
              await setup.done();
            }
            // The coder's app is live from its first call, so it can open it whenever it wants.
            if (policy.workspace === "app") await executor.app();
          } catch (error) {
            await executor.dispose();
            throw error;
          }
          if (design)
            designCheck = createDesignCheck(workspace, (signal) =>
              executor.command("check-app", [DESIGNS], signal),
            );
          return executor;
        });
        // A failed setup is retried by the next call rather than failing every later one.
        sandbox.catch(() => {
          sandbox = undefined;
        });
        return sandbox;
      };
      const lazySandbox: ToolRunner = {
        run: async (call, signal) => {
          const ready = open(signal);
          if (call.name === APP_STATUS_TOOL) {
            const app = await (await ready).app();
            const answers = await fetch(app.url, {
              signal: AbortSignal.timeout(3000),
            }).then(
              (response) => response.status,
              () => null,
            );
            return {
              callId: call.id,
              content: JSON.stringify({
                ...app,
                answers,
                ...(repository ? { versioning: repository.status() } : {}),
              }),
              ...(app.running ? {} : { isError: true }),
            };
          }
          const command = (call.arguments as { command?: unknown } | undefined)
            ?.command;
          if (
            call.name === "run_shell" &&
            typeof command === "string" &&
            backgrounds(command)
          )
            return {
              callId: call.id,
              content:
                "refused: a command must finish before it returns, so nothing runs in the background here. check-app builds the app, starts it and opens its pages itself.",
              isError: true,
            };
          const workspace = await realpath(env.toolCwd);
          const path = (call.arguments as { path?: unknown } | undefined)?.path;
          // A large result is spilled to tool-output://<callId>; the sandboxed child has no blob
          // reader, so read_file of one is answered here from the run's own storage.
          if (
            call.name === "read_file" &&
            typeof path === "string" &&
            path.startsWith("tool-output://")
          ) {
            spilled ??= createPosixTools({
              cwd: workspace,
              blobReader: createBlobReader(env.storage),
            });
            // Models drop a slash from tool-output:///<callId> and retry the same URI verbatim.
            const uri = path.replace(
              /^tool-output:\/\/(?!\/)/,
              "tool-output:///",
            );
            return spilled.run(
              { ...call, arguments: { ...call.arguments, path: uri } },
              signal,
            );
          }
          // The sandbox refuses an outside write with a bare EPERM, which a model retries
          // verbatim until the doom guard fails the run; name the mistake instead.
          if (
            typeof path === "string" &&
            isAbsolute(path) &&
            relative(workspace, path).startsWith("..")
          ) {
            // Setup stages the inputs the corrected path may name.
            await ready;
            return {
              callId: call.id,
              content: `path_outside_workspace: ${path} is not inside the workspace ${workspace}; ${await meant(workspace, path)}`,
              isError: true,
            };
          }
          // A model can drop the long text argument of a write, or send arguments that are not JSON,
          // which the harness passes on as _raw. Retrying the same long call loses it again.
          if (WRITES.has(call.name)) {
            const args = (call.arguments ?? {}) as Record<string, unknown>;
            const field = call.name === "write_file" ? "content" : "new_string";
            if (typeof args[field] !== "string")
              return {
                callId: call.id,
                content: `${field}_missing: the ${field} argument did not arrive${"_raw" in args ? " because the call's arguments were not valid JSON" : ""}. Long text arrives reliably in parts: write_file a short first part, then add the rest with edit_file a section at a time.`,
                isError: true,
              };
          }
          // tools-posix writes blindly (write-file.ts), so a model that repeats a write it already
          // made never learns it changed nothing, and the third repeat trips the doom guard.
          const content = (call.arguments as { content?: unknown } | undefined)
            ?.content;
          if (
            call.name === "write_file" &&
            typeof path === "string" &&
            typeof content === "string"
          ) {
            const existing = await readFile(
              resolve(workspace, path),
              "utf8",
            ).catch(() => undefined);
            if (existing === content)
              return {
                callId: call.id,
                content: `unchanged: ${relative(workspace, resolve(workspace, path))} already has exactly this content; the earlier write succeeded`,
              };
          }
          const ran = await (await ready).run(call, signal);
          const result =
            policy.workspace === "app" && passedAppCheck(call, ran)
              ? {
                  ...ran,
                  content: `${ran.content}\n${await fileCheckedApp(workspace, signal)}`,
                }
              : ran;
          // Results name files relative to the workspace, the form a model should send back.
          return typeof result.content === "string"
            ? {
                ...result,
                content: result.content.replaceAll(workspace + sep, ""),
              }
            : result;
        },
      };
      // A written file's imports of packages its package.json lacks: those another package of the
      // workspace already installed are added here, and the rest named with the call that adds them.
      // The app loads packages only when it starts.
      const restartForPackages = async () => {
        const restart = (await sandbox)?.restartApp();
        if (!restart) return "";
        void restart.catch((error: unknown) =>
          log.warn(
            "Restarting the app for new packages failed",
            requestErrorMetadata(error),
          ),
        );
        return "The app restarts to load the new packages.";
      };
      const installImports = async (
        call: ToolCall,
        path: string,
        signal: AbortSignal,
      ) => {
        const workspace = await realpath(env.toolCwd);
        const missing = await undeclaredImports(workspace, path);
        if (!missing?.packages.length) return "";
        const { directory, packages } = missing;
        const manifest = join(directory, "package.json");
        if (!WorkspacePath.allows(directory))
          return `${path} imports ${packages.join(", ")}, which ${manifest} does not list.`;
        const present = await installedPackages(workspace);
        const ask = packages.filter((name) => !present.has(name));
        const auto = packages.filter((name) => present.has(name));
        const notes = [];
        if (auto.length) {
          const installed = await native.run(
            {
              id: `${call.id}-imports`,
              name: PACKAGE_INSTALL_TOOL,
              arguments: { workspace: directory, packages: auto },
            },
            signal,
          );
          notes.push(
            succeeded(installed)
              ? `${path} imports ${auto.join(", ")}, which ${manifest} did not list, so ${auto.length === 1 ? "it was" : "they were"} installed into ${directory}. ${await restartForPackages()}`.trim()
              : `Installing ${auto.join(", ")} into ${directory}, which ${path} imports, failed:\n${String(installed.content).slice(-1500)}`,
          );
        }
        if (ask.length)
          notes.push(
            `${path} imports ${ask.join(", ")}, which ${manifest} does not list. Add ${ask.length === 1 ? "it" : "them"} with install_packages ${JSON.stringify({ workspace: directory, packages: ask })}`,
          );
        return notes.join("\n");
      };
      const browserNames = new Set(
        policy.browser?.tools.map((tool) => tool.name),
      );
      // The browser server restarts after it exits, on a new port, so its tools follow the URL.
      const runBrowser = async (call: ToolCall, signal: AbortSignal) => {
        const url = await (await open(signal)).browser();
        if (browser?.url !== url) {
          void browser?.tools.then(
            (tools) => tools.dispose?.(),
            () => undefined,
          );
          const tools = browserTools(url).then((factory) => factory(env));
          browser = { url, tools };
          tools.catch(() => {
            if (browser?.tools === tools) browser = undefined;
          });
        }
        return (await browser.tools).run(call, signal);
      };
      const native = createCodingTools({
        workspace: env.toolCwd,
        executor: lazySandbox,
        approval: policy.approval,
        ...(policy.packageInstall ? { packageInstall: true } : {}),
        app: policy.workspace === "app",
      }).factory(env);
      return {
        ...native,
        definitions: [
          ...native.definitions.filter((tool) => offered(tool.name)),
          ...(design ? [checkDesignDefinition] : []),
          ...(policy.browser?.tools ?? []),
        ],
        run: async (call, signal) => {
          if (browserNames.has(call.name)) return runBrowser(call, signal);
          if (design && call.name === CHECK_DESIGN_TOOL) {
            await open(signal);
            if (!designCheck) throw new Error("design_check_missing");
            const { checklist } = await designCheck.current(signal);
            return { callId: call.id, content: checklist };
          }
          if (!offered(call.name))
            return {
              callId: call.id,
              content: `unknown_tool: ${call.name}`,
              isError: true,
            };
          const result = await native.run(call, signal);
          if (repository && VERSIONED.has(call.name))
            repository.schedule(
              passedAppCheck(call, result) ? CHECK_PASSED : EDIT,
            );
          const versioning =
            typeof result.content === "string"
              ? repository?.unheard()
              : undefined;
          if (
            result.isError ||
            typeof result.content !== "string" ||
            !REPORTING.has(call.name)
          )
            return versioning
              ? {
                  ...result,
                  content: `${String(result.content)}\n\n${versioning}`,
                }
              : result;
          const notes = [];
          const path = call.arguments["path"];
          const executor = await sandbox;
          if (WRITES.has(call.name) && typeof path === "string") {
            if (policy.packageInstall)
              notes.push(await installImports(call, path, signal));
            // After the import scan, so a package it installed resolves.
            if (policy.workspace === "app" && executor)
              notes.push(
                await typeProbe(
                  executor,
                  await realpath(env.toolCwd),
                  path,
                  call.id,
                  signal,
                ),
              );
            if (designCheck) {
              notes.push(await designCheck.unheard());
              if (touchesDesigns(await realpath(env.toolCwd), path))
                designCheck.changed();
            }
          }
          if (call.name === PACKAGE_INSTALL_TOOL && succeeded(result))
            notes.push(await restartForPackages());
          if (versioning) notes.push(versioning);
          const reports = executor?.reports() ?? [];
          if (reports.length)
            notes.push(
              `The running app reports:\n${reports.map((report) => `- ${report}`).join("\n")}`,
            );
          return {
            ...result,
            content: [result.content, ...notes.filter(Boolean)].join("\n\n"),
          };
        },
        dispose: async () => {
          await opened?.close(AbortSignal.timeout(VERSION_CLOSE_MS));
          designCheck?.dispose();
          await native.dispose?.();
          await spilled?.dispose();
          await browser?.tools.then(
            (tools) => tools.dispose?.(),
            () => undefined,
          );
          await sandbox?.then(
            (executor) => executor.dispose(),
            () => undefined,
          );
        },
      };
    },
  });
}
