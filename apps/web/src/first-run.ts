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
