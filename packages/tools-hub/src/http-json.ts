import type { RuntimeCapabilities } from "@intx/types/runtime-capabilities";
import type { HttpMediatedCredential } from "@intx/types";

export class WorkflowHttpError extends Error {
  constructor(
    readonly status?: number,
    reason:
      | "credential_kind"
      | "body_missing"
      | "response_too_large"
      | "unspecified" = "unspecified",
    // Public API code only. Refusal bodies stay off the model audit.
    readonly refusalCode?: string,
    // Validation issues are field paths and rule text, never submitted values.
    readonly issues?: readonly { path: string; message: string }[],
    // A hub route's own curated hint for a request the caller was allowed to make.
    readonly hint?: string,
  ) {
    super(
      status === undefined
        ? "workflow_http_unavailable:" + reason
        : "workflow_http_unavailable:http_" + status,
    );
  }
}

// Resolve the native mediated handle for every call so rotation remains live.
// Refusal bodies are never exposed to the model or copied into its audit.
export async function workflowHttpJson(options: {
  capabilities: RuntimeCapabilities;
  handle: string;
  path: string;
  body?: unknown;
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
  maxResponseBytes: number;
  signal: AbortSignal;
  timeoutMs?: number;
}): Promise<unknown> {
  const { credential } = options;
  const response = await credential.fetch(options.path, {
    method: options.body === undefined ? "GET" : "POST",
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
      if (typeof parsed.hint === "string") hint = parsed.hint.slice(0, 300);
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
