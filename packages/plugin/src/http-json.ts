import { type } from "arktype";
import type { RuntimeCapabilities } from "@intx/types/runtime-capabilities";
import type { HttpMediatedCredential } from "@intx/types";

export class WorkflowHttpError extends Error {
  constructor(
    readonly status?: number,
    reason:
      | "credential_kind"
      | "response_too_large"
      | "unreachable"
      | "unspecified" = "unspecified",
    // Public API code only. Refusal bodies stay off the model audit.
    readonly refusalCode?: string,
    // Validation issues are field paths and rule text, never submitted values.
    readonly issues: readonly { path: string; message: string }[] = [],
    // A hub route's own curated hint for a request the caller was allowed to make.
    readonly hint?: string,
    // words is the provider's message for its refusal, as one printable line. It stays out of the
    // error's message, which a model reads, so a tool decides whether the person sees it.
    options?: ErrorOptions & { words?: string },
  ) {
    super(
      workflowHttpMessage(status, reason, refusalCode, issues, hint),
      options,
    );
    this.words = options?.words;
  }

  readonly words: string | undefined;

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
  issues: readonly { path: string; message: string }[],
  hint: string | undefined,
) {
  if (status === undefined) return "workflow_http_unavailable:" + reason;
  if (status < 400 || status >= 500)
    return "workflow_http_unavailable:http_" + status;
  const code = refusalCode ?? "hub_refused";
  const explanation = hint ?? `the hub refused the call (HTTP ${status})`;
  const parts = [`${code}: ${explanation}`];
  for (const issue of issues) parts.push(`${issue.path} ${issue.message}`);
  return parts.join("; ");
}

// A Builder tool whose hub call was refused because the run's token or grants are gone tags its
// result, so the director lets the agent's reply out rather than hold it: its job has ended, and
// holding only repeats the refusal. Hub and Interchange both answer a missing grant as forbidden;
// any other 403, such as artifact_write_refused, is a mistake the agent can correct.
const AccessRefused = type({ accessRefused: "true" });

/** The detail an access-refused tool result carries, or nothing for any other failure. */
export function accessRefusal(error: unknown) {
  if (!(error instanceof WorkflowHttpError)) return {};
  if (
    error.status === 401 ||
    (error.status === 403 && error.refusalCode === "forbidden")
  ) {
    return { detail: { accessRefused: true } };
  }
  return {};
}

/** Whether a tool result's detail says the hub refused the call for access. */
export const accessRefused = (detail: unknown) =>
  !(AccessRefused(detail) instanceof type.errors);

// Resolve the native mediated handle for every call so rotation remains live. Of a refusal's body
// only its code, hint and field issues reach the model and its audit. With signedIn, a call refused
// with a 401 is asked again while a signed-in token may be renewing, resolving the handle afresh
// each time. Without it a 401 throws at once, as for a refused pasted key.
export async function workflowHttpJson(options: {
  capabilities: RuntimeCapabilities;
  handle: string;
  path: string;
  body?: unknown;
  // A call with a body is posted and one without is a GET, unless this says otherwise.
  method?: HttpMethod;
  maxResponseBytes: number;
  signal: AbortSignal;
  timeoutMs?: number;
  signedIn?: SignedIn;
}): Promise<unknown> {
  const once = async () => {
    const credential = await options.capabilities
      .resolve("credentials")
      .resolve(options.handle);
    if (credential.kind !== "http")
      throw new WorkflowHttpError(undefined, "credential_kind");
    return mediatedHttpJson({ ...options, credential });
  };
  return options.signedIn === undefined
    ? once()
    : askingWhileRenewed(once, options.signal, options.signedIn);
}

/**
 * The origin still refused the credential after the waits a renewed sign-in gets. The person signs
 * in again, or tries again once the token is renewed. A tool answers it as try_again.
 */
export class CredentialRefused extends WorkflowHttpError {
  constructor() {
    super(
      401,
      "unspecified",
      "try_again",
      [],
      "the account's sign-in was refused; it may still be renewing, so try again in a minute, or the person signs in again",
    );
    this.name = "CredentialRefused";
  }
}

// How long to wait before each new ask after an origin refuses a signed-in token. The hub renews a
// token before it expires and pushes the new one to the run, but a token renewed just as a call is
// made reaches the run shortly after.
const RENEWAL_WAITS = [2_000, 5_000, 10_000];

export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE";

/** Marks a call made with a credential the person may have signed in for. sleep is what its waits
 * sleep with; a test passes its own. */
export type SignedIn = { sleep?: (ms: number) => Promise<void> };

const sleepFor = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Sleeps ms, unless the run is cancelled first, which throws as a cancelled call does. */
export async function waitFor(
  sleep: (ms: number) => Promise<void>,
  ms: number,
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  const cancelled = Promise.withResolvers<never>();
  const cancel = () => cancelled.reject(signal.reason);
  signal.addEventListener("abort", cancel, { once: true });
  try {
    await Promise.race([sleep(ms), cancelled.promise]);
  } finally {
    signal.removeEventListener("abort", cancel);
  }
}

const refusedCredential = (error: unknown) =>
  error instanceof WorkflowHttpError && error.status === 401;

/**
 * Makes a call whose 401 may only mean its signed-in token was renewed a moment ago. It asks again
 * after about 2, 5 and 10 seconds, then throws CredentialRefused. No other failure is asked again:
 * a call that timed out, failed on the origin's side or lost its connection may already have
 * taken effect.
 */
async function askingWhileRenewed(
  call: () => Promise<unknown>,
  signal: AbortSignal,
  { sleep = sleepFor }: SignedIn,
) {
  for (const wait of RENEWAL_WAITS) {
    try {
      return await call();
    } catch (error) {
      if (!refusedCredential(error)) throw error;
    }
    await waitFor(sleep, wait, signal);
  }
  try {
    return await call();
  } catch (error) {
    if (refusedCredential(error)) throw new CredentialRefused();
    throw error;
  }
}

export async function mediatedHttpJson(options: {
  credential: HttpMediatedCredential;
  path: string;
  body?: unknown;
  method?: HttpMethod;
  maxResponseBytes: number;
  signal: AbortSignal;
  timeoutMs?: number;
}): Promise<unknown> {
  const { credential } = options;
  let response: Response;
  try {
    const request: RequestInit = {
      method: options.method ?? "GET",
      credentials: "omit",
      // A redirect could carry the credential's header to an address it is not pinned to.
      redirect: "manual",
      signal: AbortSignal.any([
        options.signal,
        AbortSignal.timeout(options.timeoutMs ?? 15_000),
      ]),
    };
    if (options.body !== undefined) {
      request.method = options.method ?? "POST";
      request.headers = { "content-type": "application/json" };
      request.body = JSON.stringify(options.body);
    }
    response = await credential.fetch(options.path, request);
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
    let words: string | undefined;
    const text = await response.text();
    try {
      const value: unknown = JSON.parse(text);
      if (!value || typeof value !== "object") throw new SyntaxError(text);
      const parsed = value as {
        code?: unknown;
        error?: { code?: unknown };
        issues?: unknown;
        hint?: unknown;
        message?: unknown;
      };
      if (typeof parsed.hint === "string") hint = parsed.hint.slice(0, 600);
      words = providerLine(parsed.message);
      // Interchange routes nest the code under `error`; hub routes put it at the top.
      const code = parsed.code ?? parsed.error?.code;
      if (typeof code === "string" && /^[a-z0-9_]+$/.test(code))
        refusalCode = code;
      if (Array.isArray(parsed.issues)) {
        issues = [];
        for (const issue of parsed.issues) {
          if (!issue || typeof issue !== "object") continue;
          if (
            typeof issue.path !== "string" ||
            typeof issue.message !== "string"
          )
            continue;
          issues.push({
            path: issue.path.slice(0, 200),
            message: issue.message.slice(0, 200),
          });
        }
      }
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
      words === undefined ? undefined : { words },
    );
  }
  // A call answered with nothing, such as a delete, has done what it asked.
  if (response.status === 204) {
    await response.body?.cancel();
    return undefined;
  }
  const reader = response.body?.getReader();
  if (!reader) return undefined;
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
    if (length === 0) return undefined;
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)),
    );
  } finally {
    await reader.cancel();
  }
}

/**
 * A provider's message as one printable line of at most 300 characters, or undefined for none.
 * Control characters could forge lines in whatever shows the message, and nothing else bounds its
 * length.
 */
export function providerLine(text: unknown): string | undefined {
  if (typeof text !== "string") return undefined;
  const line = text
    .replace(/\p{Cc}+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
  return line === "" ? undefined : line;
}
