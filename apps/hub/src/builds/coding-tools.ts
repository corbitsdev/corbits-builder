import { defineTool } from "@intx/agent/authoring";
import { posix } from "@intx/tools-posix/sidecar-bundle";
import type { ToolRunner } from "@intx/types/runtime";
import { type } from "arktype";
import type { ApprovedPackages } from "@corbits-builder/schemas/package-install";
import {
  PortVariable,
  type AppRun,
} from "@corbits-builder/schemas/installed-workflows";
import {
  createPackageGate,
  packageInstallDefinitions,
} from "./package-install.ts";

export const APP_STATUS_TOOL = "app_status";
export const AppStatusInput = type({
  "+": "reject",
  "command?": "string > 0",
  "waitFor?": "string > 0",
  "port?": PortVariable,
});
const appStatusDefinition = {
  name: APP_STATUS_TOOL,
  description:
    "Starts and reports on the program that keeps running while you work, such as the project's dev server, a server, a bot or a desktop app: its command, url (its address, to open in the browser), ports (the port each environment variable was given), whether it is running, whether it is ready, and the last lines of its log. Nothing runs until you first call it. With no command it starts the project's own program (its stack.run), or reports on what runs, starting it again only if it or one of its parts failed. A command starts that program instead, stopping whatever ran. Every program gets a free port in each port variable the project's stack.run declares (in the web starter CLIENT_PORT for the page and PORT for the API), or in PORT alone when it declares none, and its url is served from stack.run's port variable; name another variable in port to serve the url from it instead, and it is given a port too. A variable keeps its port across restarts. When waitFor is given the call waits until that text appears in its output. The program keeps running across your later calls, reloads code changes itself when its command watches files, and stops when your run ends. There is no display: a program that needs a window starts and its output can be read, but nothing is drawn, so prove its logic with tests and say in your reply what could not be seen.",
  inputSchema: { ...AppStatusInput.toJsonSchema() },
};

// The tools that run a command line the agent wrote.
const COMMAND_TOOLS = new Set(["run_shell", APP_STATUS_TOOL]);

/**
 * The program a command given to app_status runs: given a port in each variable the project's own
 * program is, or PORT alone, and answering on the variable the call names, else the project's.
 */
export function startedRun(
  command: string,
  input: { waitFor?: string; port?: string },
  declared: AppRun | undefined,
): AppRun {
  const variables = declared
    ? [declared.port, ...(declared.extraPorts ?? [])]
    : ["PORT"];
  const port = input.port ?? variables[0]!;
  const run: AppRun = {
    command,
    port,
    extraPorts: variables.filter((name) => name !== port),
  };
  if (input.waitFor !== undefined) run.waitFor = input.waitFor;
  return run;
}

export function createCodingTools(options: {
  workspace: string;
  executor: ToolRunner;
  approval: "ask" | "allow";
  approvedPackages?: (signal: AbortSignal) => Promise<ApprovedPackages>;
  app?: boolean;
}) {
  if (!["ask", "allow"].includes(options.approval))
    throw new Error("explicit_tool_approval_policy_required");
  const factory = defineTool({
    id: "@corbits-builder/coding/posix",
    // The trusted host explicitly selects the invocation policy. No default
    // turns native POSIX ask marks into unattended authority. This declaration
    // still goes through the stock capability walk and native grant evaluator.
    definitions: posix.definitions.map((item) =>
      options.approval === "ask"
        ? { name: item.name, approval: "ask" as const }
        : { name: item.name },
    ),
    factory: (env) => {
      const native = posix({ ...env, toolCwd: options.workspace });
      const gate = options.approvedPackages
        ? createPackageGate(
            options.workspace,
            options.executor,
            options.approvedPackages,
          )
        : undefined;
      return {
        definitions: [
          ...native.definitions,
          ...(gate ? packageInstallDefinitions : []),
          ...(options.app ? [appStatusDefinition] : []),
        ],
        run: async (call, signal) => {
          if (gate?.handles(call.name)) return gate.run(call, signal);
          return (
            (COMMAND_TOOLS.has(call.name)
              ? await gate?.refuseShell(call)
              : undefined) ?? options.executor.run(call, signal)
          );
        },
        dispose: async () => {
          await native.dispose?.();
        },
      };
    },
  });
  return { factory };
}
