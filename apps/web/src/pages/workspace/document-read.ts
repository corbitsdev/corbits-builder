/**
 * How a failed document read shows in the reading pane. A missing or rejected
 * document is not a tab. A transient failure of a document that exists keeps
 * its tab so the person can retry.
 */
import { ProductApiError } from "@corbits-builder/client";
import { humanFault } from "./human-fault.ts";

export function documentReadFailure(cause: unknown): {
  message: string;
  retryable: boolean;
} {
  const status =
    cause instanceof ProductApiError ? cause.response.status : undefined;
  const retryable =
    status === undefined ||
    status === 408 ||
    status === 409 ||
    status === 429 ||
    status >= 500;
  const fallback = retryable
    ? "The document could not be read. Try again."
    : "This document is not available.";
  return { message: humanFault(cause, fallback), retryable };
}

type PaneLoadState = {
  status: "loading" | "ready" | "error";
  retryable?: boolean;
};

/** Drop a document the hub rejected or could not find. Keep retries. */
export function documentsForPane<T>(
  deliverables: readonly T[],
  stateFor: (item: T) => PaneLoadState | undefined,
): T[] {
  return deliverables.filter((item) => {
    const state = stateFor(item);
    return !(state?.status === "error" && state.retryable !== true);
  });
}
