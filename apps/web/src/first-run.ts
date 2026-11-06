import { ApiFailure } from "./api/types.ts";

/** Which full screen first launch shows: the better-auth session is the only gate. */
export type HubAuthState = "unknown" | "signed-out" | "signed-in";

export type FirstRunScreen = "boot" | "auth" | "ready";

export function firstRunScreen(input: { auth: HubAuthState }): FirstRunScreen {
  // Signed-out is known independently of any status probe: a 401 on the
  // session check itself is what reveals it (e.g. the hub restarted and the
  // session cookie no longer holds).
  if (input.auth === "signed-out") return "auth";
  if (input.auth === "unknown") return "boot";
  return "ready";
}

export interface HubRead {
  data: unknown;
  error: Error | null;
}

function failureStatus(failure: Error): number | undefined {
  if (failure instanceof ApiFailure) return failure.httpStatus;
  if ("response" in failure && failure.response instanceof Response) {
    return failure.response.status;
  }
  return undefined;
}

/**
 * What the fold reads' failures mean. A 401/403 means the session cookie no
 * longer holds: that is "not signed in", not "not answering". Only a dropped
 * connection or a real server error is offline.
 */
export function hubReadState(reads: readonly HubRead[]): {
  signedOut: boolean;
  offline: boolean;
  blocksShell: boolean;
} {
  const failed = reads.flatMap(({ data, error }) =>
    error ? [{ status: failureStatus(error), unread: data === undefined }] : [],
  );
  const signedOut = failed.some(
    ({ status }) => status === 401 || status === 403,
  );
  const down = signedOut
    ? []
    : failed.filter(({ status }) => status === undefined || status >= 500);
  return {
    signedOut,
    offline: down.length > 0,
    // A failed refresh keeps its last data, so whatever is open stays on
    // screen under the offline banner; only a hub never read blocks it.
    blocksShell: down.some(({ unread }) => unread),
  };
}
