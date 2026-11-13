import { type } from "arktype";
import type { RuntimeCapabilities } from "@intx/types/runtime-capabilities";
import type { HttpMediatedCredential } from "@intx/types";

export class WorkflowHttpError extends Error {
  constructor(
    readonly status?: number,
    reason:
      | "credential_kind"
      | "body_missing"
      | "response_too_large"
      | "unreachable"
      | "unspecified" = "unspecified",
    // Public API code only. Refusal bodies stay off the model audit.
    readonly refusalCode?: string,
    // Validation issues are field paths and rule text, never submitted values.
    readonly issues?: readonly { path: string; message: string }[],
    // A hub route's own curated hint for a request the caller was allowed to make.
    readonly hint?: string,
    options?: ErrorOptions,
  ) {
    super(
      workflowHttpMessage(status, reason, refusalCode, issues, hint),
      options,
    );
  }

  /** Whether the hub answered and refused the call, which asking again the same way will not change. */
  get refused() {
    return this.status !== undefined && this.status >= 400 && this.status < 500;
  }
}

// A refusal reads as the hub's code and why, the way every tool refusal reads to a model; only a
// hub that could not be reached, or failed, is unavailable.
function workflowHttpMessage(
  status: number | undefined,
  reason: string,
  refusalCode: string | undefined,
  issues: readonly { path: string; message: string }[] | undefined,
  hint: string | undefined,
) {
  if (status === undefined) return "workflow_http_unavailable:" + reason;
  if (status < 400 || status >= 500)
    return "workflow_http_unavailable:http_" + status;
  return [
    `${refusalCode ?? "hub_refused"}: ${hint ?? `the hub refused the call (HTTP ${status})`}`,
    ...(issues ?? []).map((issue) => `${issue.path} ${issue.message}`),
  ].join("; ");
}

// A Builder tool whose hub call was refused because the run's token or grants are gone tags its
// result, so the director lets the agent's reply out rather than hold it: its job has ended, and
// holding only repeats the refusal. Hub and Interchange both answer a missing grant as forbidden;
// any other 403, such as artifact_write_refused, is a mistake the agent can correct.
const AccessRefused = type({ accessRefused: "true" });

/** The detail an access-refused tool result carries, or nothing for any other failure. */
export const accessRefusal = (error: unknown) =>
  error instanceof WorkflowHttpError &&
  (error.status === 401 ||
    (error.status === 403 && error.refusalCode === "forbidden"))
    ? { detail: { accessRefused: true } }
    : {};

/** Whether a tool result's detail says the hub refused the call for access. */
export const accessRefused = (detail: unknown) =>
  !(AccessRefused(detail) instanceof type.errors);

// Resolve the native mediated handle for every call so rotation remains live.
// Of a refusal's body only its code, hint and field issues reach the model and its audit.
export async function workflowHttpJson(options: {
  capabilities: RuntimeCapabilities;
  handle: string;
  path: string;
  body?: unknown;
  // A body is posted unless this says it is put.
  method?: "PUT";
  maxResponseBytes: number;
  signal: AbortSignal;
  timeoutMs?: number;
}): Promise<unknown> {
  const credential = await options.capabilities
    .resolve("credentials")
    .resolve(options.handle);
  if (credential.kind !== "http")
    throw new WorkflowHttpError(undefined, "credential_kind");
  return mediatedHttpJson({ ...options, credential });
}

export async function mediatedHttpJson(options: {
  credential: HttpMediatedCredential;
  path: string;
  body?: unknown;
  method?: "PUT";
  maxResponseBytes: number;
  signal: AbortSignal;
  timeoutMs?: number;
}): Promise<unknown> {
  const { credential } = options;
  let response: Response;
  try {
    response = await credential.fetch(options.path, {
      method: options.method ?? (options.body === undefined ? "GET" : "POST"),
      credentials: "omit",
      ...(options.body === undefined
        ? {}
        : {
            headers: { "content-type": "application/json" },
            body: JSON.stringify(options.body),
          }),
      signal: AbortSignal.any([
        options.signal,
        AbortSignal.timeout(options.timeoutMs ?? 15_000),
      ]),
    });
  } catch (error) {
    // The caller's own cancellation is not the hub's failure.
    if (options.signal.aborted) throw error;
    throw new WorkflowHttpError(
      undefined,
      "unreachable",
      undefined,
      undefined,
      undefined,
      { cause: error },
    );
  }
  if (!response.ok) {
    let refusalCode: string | undefined;
    let issues: { path: string; message: string }[] | undefined;
    let hint: string | undefined;
    const text = await response.text();
    try {
      const value: unknown = JSON.parse(text);
      if (!value || typeof value !== "object") throw new SyntaxError(text);
      const parsed = value as {
        code?: unknown;
        error?: { code?: unknown };
        issues?: unknown;
        hint?: unknown;
      };
      if (typeof parsed.hint === "string") hint = parsed.hint.slice(0, 600);
      // Interchange routes nest the code under `error`; hub routes put it at the top.
      const code = parsed.code ?? parsed.error?.code;
      if (typeof code === "string" && /^[a-z0-9_]+$/.test(code))
        refusalCode = code;
      if (Array.isArray(parsed.issues))
        issues = parsed.issues.flatMap((issue: unknown) =>
          issue &&
          typeof issue === "object" &&
          "path" in issue &&
          "message" in issue &&
          typeof issue.path === "string" &&
          typeof issue.message === "string"
            ? [
                {
                  path: issue.path.slice(0, 200),
                  message: issue.message.slice(0, 200),
                },
              ]
            : [],
        );
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      // A refusal body that is not JSON carries no code.
    }
    throw new WorkflowHttpError(
      response.status,
      "unspecified",
      refusalCode,
      issues,
      hint,
    );
  }
  const reader = response.body?.getReader();
  if (!reader) throw new WorkflowHttpError(undefined, "body_missing");
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      length += next.value.length;
      if (length > options.maxResponseBytes)
        throw new WorkflowHttpError(undefined, "response_too_large");
      chunks.push(next.value);
    }
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)),
    );
  } finally {
    await reader.cancel();
  }
}
