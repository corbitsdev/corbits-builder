import type { Context } from "hono";
import type { TenantEnv } from "@intx/hub-api";
import type { QuestionAnswer } from "@intx/types/signals";
import { ProjectError } from "../projects/errors.ts";
import { readJson } from "../lib/json.ts";

/** The person's own credentials from their request, for a request the hub makes on their behalf. */
export function callerHeaders(c: Context<TenantEnv>) {
  const headers = new Headers();
  for (const name of ["cookie", "authorization"]) {
    const value = c.req.header(name);
    if (value) headers.set(name, value);
  }
  return headers;
}

// A POST to Interchange's own run routes on the person's behalf, with the person's own credentials,
// exactly as the UI would make it. A refusal keeps Interchange's code; failure names the rest.
async function postAsCaller(
  c: Context<TenantEnv>,
  nativeFetch: ((request: Request) => Promise<Response>) | undefined,
  path: string,
  body: unknown,
  failure: string,
): Promise<void> {
  if (!nativeFetch) throw new ProjectError(503, `${failure}_unavailable`);
  const headers = callerHeaders(c);
  headers.set("content-type", "application/json");
  const response = await nativeFetch(
    new Request(new URL(path, c.req.url).href, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    }),
  );
  if (response.ok) return;
  const payload: unknown = await readJson(response);
  const upstream =
    payload !== null && typeof payload === "object" && "error" in payload
      ? payload.error
      : null;
  const status =
    ([400, 403, 404, 409] as const).find(
      (known) => known === response.status,
    ) ?? 503;
  throw new ProjectError(
    status,
    upstream !== null && typeof upstream === "object" && "code" in upstream
      ? String(upstream.code)
      : `${failure}_${response.status}`,
  );
}

const workflowsPath = (tenantId: string) =>
  `/api/tenants/${encodeURIComponent(tenantId)}/workflows`;

// Mail the hub sends on the person's behalf goes through the native run mail route.
export async function mailRunAsCaller(
  c: Context<TenantEnv>,
  nativeFetch: ((request: Request) => Promise<Response>) | undefined,
  tenantId: string,
  runId: string,
  content: string,
  attachments?: readonly { name: string; mimeType: string; data: string }[],
): Promise<void> {
  await postAsCaller(
    c,
    nativeFetch,
    `${workflowsPath(tenantId)}/runs/${encodeURIComponent(runId)}/mail`,
    attachments ? { content, attachments } : { content },
    "run_mail",
  );
}

// The person's answer to a question the run parked on goes through the run's native signal route,
// which the run takes as the question call's result.
export async function answerQuestionAsCaller(
  c: Context<TenantEnv>,
  nativeFetch: ((request: Request) => Promise<Response>) | undefined,
  run: { tenantId: string; runId: string },
  signalName: string,
  answer: QuestionAnswer,
): Promise<void> {
  await postAsCaller(
    c,
    nativeFetch,
    `${workflowsPath(run.tenantId)}/${encodeURIComponent(run.runId)}/signals`,
    { runId: run.runId, signalName, signalId: signalName, payload: answer },
    "question_answer",
  );
}
