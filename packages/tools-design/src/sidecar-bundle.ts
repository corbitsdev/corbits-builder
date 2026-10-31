import { defineTool, type BaseEnv } from "@intx/agent/authoring";
import { HUB_CREDENTIAL_HANDLE } from "@intx/types/credential-delivery";
import type { RuntimeCapabilities } from "@intx/types/runtime-capabilities";
import type { ToolResult } from "@intx/types/runtime";
import {
  resolveWorkflowProjectScope,
  workflowHttpJson,
} from "@corbits-builder/tools-hub";
import {
  fileDesignOption,
  fileDesignOptionDefinition,
} from "./file-design-option.ts";

export interface DesignToolEnv extends BaseEnv {
  toolCwd: string;
  capabilities: RuntimeCapabilities;
}

// Files the designer's .builder folder as its design concept's option. The person decides on the
// design once, by choosing among the filed options, never while a designer is still working.
// failure turns a thrown error into the tool result, so the host keeps its own logging and codes.
export function createDesignTools(options: {
  failure: (callId: string, error: unknown) => ToolResult;
}) {
  return defineTool<DesignToolEnv>({
    id: "@corbits-builder/artifacts/design-tools",
    credentials: [{ handle: HUB_CREDENTIAL_HANDLE }],
    requires: ["toolCwd", "capabilities"],
    definitions: [{ name: fileDesignOptionDefinition.name }],
    factory: (env) => ({
      definitions: [fileDesignOptionDefinition],
      run: async (call, signal) => {
        if (call.name !== fileDesignOptionDefinition.name)
          return {
            callId: call.id,
            content: "unknown_design_tool",
            isError: true,
          };
        try {
          const scope = await resolveWorkflowProjectScope(
            env.capabilities,
            "designer",
            signal,
          );
          const path =
            "/api/tenants/" +
            encodeURIComponent(scope.tenantId) +
            "/projects/" +
            encodeURIComponent(scope.projectId) +
            "/artifacts";
          return await fileDesignOption({
            callId: call.id,
            workspace: env.toolCwd,
            postArtifact: (body) =>
              workflowHttpJson({
                capabilities: env.capabilities,
                handle: HUB_CREDENTIAL_HANDLE,
                path,
                body,
                maxResponseBytes: 16384,
                signal,
              }),
            signal,
          });
        } catch (error) {
          return options.failure(call.id, error);
        }
      },
    }),
  });
}
