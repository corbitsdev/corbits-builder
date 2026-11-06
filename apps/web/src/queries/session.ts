import { queryOptions } from "@tanstack/react-query";
import { getHubSession, type HubSession } from "../api/auth.ts";
import { ApiFailure } from "../api/types.ts";
import type { HubAuthState } from "../first-run.ts";
import { keys } from "./keys.ts";

/** A hub that is down or unreachable answers later; anything else will not. */
export function sessionReadRetryable(cause: unknown): boolean {
  return cause instanceof ApiFailure && cause.detail.retryable;
}

/**
 * The better-auth session, read once for the whole interface. It is re-read
 * until the hub answers, so a first check made while the hub was down still
 * settles without a reload. It is never saved: a stale identity from the
 * last visit must not open the workspace.
 */
export const sessionQuery = queryOptions<HubSession>({
  queryKey: keys.session,
  queryFn: getHubSession,
  staleTime: Infinity,
  retry: (_failures, cause) => sessionReadRetryable(cause),
  meta: { persist: false },
});

/** A session that cannot be read at all leaves only signing in again. */
export function sessionAuth(read: {
  data: HubSession | undefined;
  isError: boolean;
}): HubAuthState {
  if (read.data !== undefined) return read.data ? "signed-in" : "signed-out";
  return read.isError ? "signed-out" : "unknown";
}
