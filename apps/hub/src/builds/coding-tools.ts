import { defineTool } from "@intx/agent/authoring";
import { posix } from "@intx/tools-posix/sidecar-bundle";
import type { ToolRunner } from "@intx/types/runtime";
import {
  createPackageGate,
  packageInstallDefinitions,
} from "./package-install.ts";

export const APP_STATUS_TOOL = "app_status";
const appStatusDefinition = {
  name: APP_STATUS_TOOL,
  description:
    "The app's dev server, which runs for the whole build and reloads as files change: its URL to open in the browser, whether it is running, and the last lines of its log. Calling it starts the server again if it has stopped.",
  inputSchema: { type: "object", properties: {} },
};

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
          if (options.app && call.name === APP_STATUS_TOOL)
            return options.executor.run(call, signal);
          return (
            (await gate?.refuseShell(call)) ??
            options.executor.run(call, signal)
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
