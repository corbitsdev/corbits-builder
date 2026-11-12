import type { Context } from "hono";
import type { TenantEnv } from "@intx/hub-api";
import type { QuestionCheck } from "@intx/inference";
import { HUB_CREDENTIAL_HANDLE } from "@intx/types/credential-delivery";
import type { RuntimeCapabilities } from "@intx/types/runtime-capabilities";
import type { AskedQuestion } from "@intx/types/runtime-core";
import { ProjectValues } from "@corbits-builder/schemas/artifact";
import {
  ConversationEvents,
  parkedQuestions,
} from "@corbits-builder/schemas/conversation";
import { unknownScreen } from "@corbits-builder/plugin-host/text";
import { callerHeaders } from "../mail/caller-mail.ts";
import { readJson } from "../lib/json.ts";
import { ProjectError } from "../projects/errors.ts";
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

/**
 * The question a run is still waiting on, by its signal name, from the conversation the person
 * reads: the same run log, read with their authority, that the interface draws the question from.
 */
export async function openQuestion(
  c: Context<TenantEnv>,
  nativeFetch: ((request: Request) => Promise<Response>) | undefined,
  projectId: string,
  signalName: string,
) {
  if (!nativeFetch) throw new ProjectError(503, "question_answer_unavailable");
  const path =
    "/api/tenants/" +
    encodeURIComponent(c.req.param("tenantId") ?? c.get("tenant").id) +
    "/projects/" +
    encodeURIComponent(projectId) +
    "/conversation/events";
  const response = await nativeFetch(
    new Request(new URL(path, c.req.url).href, { headers: callerHeaders(c) }),
  );
  const read: unknown = await readJson(response);
  if (!response.ok)
    throw new ProjectError(
      response.status === 403 ? 403 : 503,
      "conversation_unreadable",
    );
  const { runId, events } = ConversationEvents.assert(read);
  const question = parkedQuestions(events).find(
    (asked) => asked.signalName === signalName,
  );
  if (runId === null || question === undefined)
    throw new ProjectError(404, "question_not_found", { signalName });
  if (question.answer !== undefined)
    throw new ProjectError(409, "question_answered", { signalName });
  return { runId, asked: question.asked };
}

/** The installed screen a question opened, or undefined for a question asked in words. */
export function screenOf(asked: AskedQuestion) {
  if (!("plugin" in asked)) return undefined;
  const installed = SCREENS.find(
    ({ plugin, action }) => plugin === asked.plugin && action === asked.action,
  );
  if (!installed) throw new ProjectError(409, "screen_not_installed");
  return installed;
}
