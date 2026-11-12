import type { Context } from "hono";
import type { TenantEnv } from "@intx/hub-api";
import type { QuestionCheck } from "@intx/inference";
import type { AskedQuestion } from "@intx/types/runtime-core";
import {
  ConversationEvents,
  parkedQuestions,
} from "@corbits-builder/schemas/conversation";
import {
  screenRefusal,
  type Project,
} from "@corbits-builder/plugin-host/coordinator";
import { unknownScreen } from "@corbits-builder/plugin-host/text";
import { callerHeaders } from "../mail/caller-mail.ts";
import { readJson } from "../lib/json.ts";
import { ProjectError } from "../projects/errors.ts";
import { CATALOG, SCREENS } from "./catalog.ts";

// Refuses a screen's input, or a project without what the screen needs, before the question parks,
// so the person never sees a screen that cannot draw. A screen is checked against the project as it
// is, so a failed read is thrown.
export async function checkPluginQuestion(
  question: Parameters<QuestionCheck>[0],
  project: Project,
) {
  const installed = SCREENS.find(
    ({ plugin, action }) =>
      plugin === question.plugin && action === question.action,
  );
  if (!installed) return unknownScreen(question, SCREENS);
  return screenRefusal(CATALOG, project, installed, question.input);
}

/**
 * The coordinator run and every question it parked on, from the conversation the person reads: the
 * same run log, read with their authority, that the interface draws the questions from.
 */
export async function askedQuestions(
  c: Context<TenantEnv>,
  nativeFetch: ((request: Request) => Promise<Response>) | undefined,
  projectId: string,
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
  return { runId, questions: parkedQuestions(events) };
}

/** The question a run is still waiting on, by its signal name. */
export async function openQuestion(
  c: Context<TenantEnv>,
  nativeFetch: ((request: Request) => Promise<Response>) | undefined,
  projectId: string,
  signalName: string,
) {
  const { runId, questions } = await askedQuestions(c, nativeFetch, projectId);
  const question = questions.find((asked) => asked.signalName === signalName);
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
