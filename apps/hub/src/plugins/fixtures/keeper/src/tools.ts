import { defineTool } from "@intx/agent/authoring";
import { isUnboundCredentialError } from "@intx/types";
import { HUB_CREDENTIAL_HANDLE } from "@intx/types/credential-delivery";
import { workflowHttpJson } from "@corbits-builder/plugin/http-json";
import { resolveWorkflowProjectScope } from "@corbits-builder/plugin/project-scope";
import { defineTools, type ToolEnv } from "@corbits-builder/plugin/tools";

// What publishing without a key returns: the link that lets the person take over the published app.
export const KEEP_LINK = "https://keeper.example/keep/fixture-keep-token";

// Publishes with the saved key when there is one. Without a key it publishes keyless and saves the
// keep link to the project itself, so the model never sees it.
export default defineTools(({ role }) => [
  defineTool<ToolEnv>({
    id: "@corbits-builder/keeper/tools",
    credentials: [{ handle: "keeper-api" }, { handle: HUB_CREDENTIAL_HANDLE }],
    requires: ["capabilities"],
    definitions: [{ name: "keeper_publish" }],
    factory: (env) => ({
      definitions: [
        {
          name: "keeper_publish",
          description: "Publish the app to Keeper and say which way it went.",
          inputSchema: {
            type: "object",
            properties: {},
            additionalProperties: false,
          },
        },
      ],
      run: async (call, signal) => {
        const credentials = env.capabilities.resolve("credentials");
        let api;
        try {
          api = await credentials.resolve("keeper-api");
        } catch (error) {
          if (!isUnboundCredentialError(error)) throw error;
          const { tenantId, projectId } = await resolveWorkflowProjectScope(
            env.capabilities,
            role,
            signal,
          );
          await workflowHttpJson({
            capabilities: env.capabilities,
            handle: HUB_CREDENTIAL_HANDLE,
            path: `/api/tenants/${encodeURIComponent(tenantId)}/projects/${encodeURIComponent(projectId)}/run-values`,
            body: { values: { "keeper.keep": { link: KEEP_LINK } } },
            maxResponseBytes: 65_536,
            signal,
          });
          return {
            callId: call.id,
            content: JSON.stringify({ keyed: false }),
          };
        }
        if (api.kind !== "http")
          throw new Error("keeper-api is not an http credential");
        const response = await api.fetch("/publish", { method: "POST" });
        return {
          callId: call.id,
          content: JSON.stringify({ keyed: true, status: response.status }),
        };
      },
    }),
  }),
]);
