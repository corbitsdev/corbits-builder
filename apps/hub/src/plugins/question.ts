import type { QuestionCheck } from "@intx/inference";
import { HUB_CREDENTIAL_HANDLE } from "@intx/types/credential-delivery";
import type { RuntimeCapabilities } from "@intx/types/runtime-capabilities";
import { ProjectValues } from "@corbits-builder/schemas/artifact";
import { unknownScreen } from "@corbits-builder/plugin-host/text";
import { resolveWorkflowProjectScope } from "../workflows/project-scope.ts";
import { workflowHttpJson } from "../workflows/http-json.ts";
import { SCREENS } from "./catalog.ts";

// The project values a screen reads, from the hub as the run, each undefined where the project
// has none yet.
async function readProjectValues(
  capabilities: RuntimeCapabilities,
  project: { tenantId: string; projectId: string } | undefined,
  names: readonly string[],
) {
  const signal = new AbortController().signal;
  const { tenantId, projectId } =
    project ??
    (await resolveWorkflowProjectScope(capabilities, "coordinator", signal));
  const { values } = ProjectValues.assert(
    await workflowHttpJson({
      capabilities,
      handle: HUB_CREDENTIAL_HANDLE,
      path:
        "/api/tenants/" +
        encodeURIComponent(tenantId) +
        "/projects/" +
        encodeURIComponent(projectId) +
        "/values?" +
        new URLSearchParams({ keys: names.join(",") }).toString(),
      maxResponseBytes: 64 * 1024,
      signal,
    }),
  );
  return Object.fromEntries(
    Object.entries(values).map(([name, value]) => [name, value ?? undefined]),
  );
}

// Refuses a screen's input before the question parks, so the person never sees a screen that
// cannot draw. A screen is checked against the project as it is, so a failed read is thrown.
export async function checkPluginQuestion(
  question: Parameters<QuestionCheck>[0],
  capabilities: RuntimeCapabilities,
  project: { tenantId: string; projectId: string } | undefined,
) {
  const installed = SCREENS.find(
    ({ plugin, action }) =>
      plugin === question.plugin && action === question.action,
  );
  if (!installed) return unknownScreen(question, SCREENS);
  const reads = installed.builder.reads ?? [];
  const values =
    reads.length > 0
      ? await readProjectValues(capabilities, project, reads)
      : {};
  return installed.refusal(question.input, values);
}
