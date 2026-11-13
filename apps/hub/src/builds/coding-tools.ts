import { defineTool } from "@intx/agent/authoring";
import { posix } from "@intx/tools-posix/sidecar-bundle";
import type { ToolRunner } from "@intx/types/runtime";
import { type } from "arktype";
import type { AppRun } from "@corbits-builder/schemas/installed-workflows";
import {
  createPackageGate,
  packageInstallDefinitions,
} from "./package-install.ts";

export const APP_STATUS_TOOL = "app_status";
export const AppStatusInput = type({
  "+": "reject",
  "command?": "string > 0",
  "waitFor?": "string > 0",
});
const appStatusDefinition = {
  name: APP_STATUS_TOOL,
  description:
    "The program that keeps running while you work, such as the project's dev server, a server, a bot or a desktop app: its command, its URL to open in the browser, whether it is running, whether it is ready, and the last lines of its log. With no command it reports on what runs, starting the project's own program, or the last one, again if it has stopped. A command starts that program instead, stopping whatever ran; it is given a free port in $PORT, and when waitFor is given the call waits until that text appears in its output. It keeps running across your later calls and stops when your run ends. There is no display: a program that needs a window starts and its output can be read, but nothing is drawn, so prove its logic with tests and say in your reply what could not be seen.",
  inputSchema: { ...AppStatusInput.toJsonSchema() },
};

// The tools that run a command line the agent wrote.
const COMMAND_TOOLS = new Set(["run_shell", APP_STATUS_TOOL]);

/** The program a command given to app_status runs: answering on $PORT once it prints waitFor. */
export function startedRun(
  command: string,
  waitFor: string | undefined,
): AppRun {
  return waitFor === undefined
    ? { command, port: "PORT" }
    : { command, port: "PORT", waitFor };
}

export function createCodingTools(options: {
  workspace: string;
  executor: ToolRunner;
  approval: "ask" | "allow";
  packageInstall?: boolean;
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
      const gate = options.packageInstall
        ? createPackageGate(options.workspace, options.executor)
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
