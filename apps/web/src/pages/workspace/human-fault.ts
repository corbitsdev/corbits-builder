/**
 * What a person may read when a request fails.
 *
 * Status lines, hashes, and run ids stay in logs. The room gets one short
 * sentence, or the caller's own plain words when those words are already human.
 */
import { ProductApiError } from "@corbits-builder/client";

const STATUS_LINE =
  /^(?:bad request|unauthorized|forbidden|not found|method not allowed|not acceptable|conflict|gone|unprocessable content|too many requests|internal server error|not implemented|bad gateway|service unavailable|gateway timeout)$/i;

const INTERNAL = /\b(?:run_[A-Za-z0-9_-]+|[0-9a-f]{64}|HTTP\s*\d{3})\b/i;

const CONFLICT_SENTENCES: Readonly<Record<string, string>> = {
  artifact_ask_target_changed:
    "This document changed while you were reviewing it. Reopen it to see the latest version.",
  artifact_review_mismatch:
    "This request no longer matches the document. Reopen it to see the latest version.",
  invalid_artifact_ask:
    "This request could not be read. Ask the coordinator to send it again.",
  artifact_ask_coordinator_unavailable:
    "The coordinator is not running, so it cannot receive your decision yet.",
  artifact_ask_bytes_unavailable:
    "That document is not available to review yet.",
  artifact_decision_invalid: "That decision could not be read.",
  artifact_decision_native_proof_unavailable:
    "That decision cannot be confirmed right now.",
  project_archived: "This project is archived. Restore it to make changes.",
  stale_revision:
    "The project changed while you were working. Reopen it and try again.",
  project_busy: "The project is busy right now. Try again in a moment.",
  coordinator_capacity_full:
    "This computer is already running as many agents as it allows, so this project's coordinator could not start. Close or archive another project, then try again.",
};

function faultForStatus(status: number, fallback: string): string {
  if (status === 401 || status === 403) return "You need to sign in again.";
  if (status === 404) return "That is not available.";
  if (status === 408 || status === 429)
    return "That is taking too long. Try again.";
  if (status === 409) return "That is still being updated. Try again.";
  if (status >= 500) return "The project could not be reached. Try again.";
  return fallback;
}

/** A sentence safe to put in the transcript, composer, or an empty state. */
export function humanFault(cause: unknown, fallback: string): string {
  if (cause instanceof ProductApiError)
    return faultForStatus(cause.response.status, fallback);
  const message = cause instanceof Error ? cause.message.trim() : "";
  if (
    message.length === 0 ||
    STATUS_LINE.test(message) ||
    INTERNAL.test(message)
  )
    return fallback;
  return message;
}

/** The `code` in a failed response's body, when there is one. */
export async function responseCode(
  cause: unknown,
): Promise<string | undefined> {
  if (!(cause instanceof ProductApiError)) return undefined;
  const body: unknown = await cause.response
    .clone()
    .json()
    .catch(() => undefined);
  return body !== null &&
    typeof body === "object" &&
    "code" in body &&
    typeof body.code === "string"
    ? body.code
    : undefined;
}

/** Like `humanFault`, but names a known conflict by the `code` in the response body. */
export async function humanFaultWithCode(
  cause: unknown,
  fallback: string,
): Promise<string> {
  const code =
    cause instanceof ProductApiError && cause.response.status === 409
      ? await responseCode(cause)
      : undefined;
  const sentence = code === undefined ? undefined : CONFLICT_SENTENCES[code];
  return sentence ?? humanFault(cause, fallback);
}
