/**
 * Signs in at a plugin's provider through the hub's sign-in routes, with the person's session. The
 * hub keeps every secret of a sign-in. This side gets only a URL to open, the sign-in's status, and
 * the account a saved sign-in connected.
 */
import {
  PluginSignInDisconnected,
  PluginSignInStarted,
  PluginSignInState,
} from "@corbits-builder/schemas/settings";
import { json, ownCredential } from "./credentials.ts";

const signIns = (project: string) =>
  `${encodeURIComponent(project)}/plugin-sign-ins`;

/** A sign-in saved in the project: the account it connected, if the provider named one, and
 * whether the provider stopped accepting it, so the person must sign in again. */
export type SavedSignIn = { account: string | undefined; signedOut: boolean };

/** The sign-in `project` itself has for the credential `name`. Undefined when it has none, or has a
 * pasted key instead. */
export async function savedSignIn(
  project: string,
  name: string,
): Promise<SavedSignIn | undefined> {
  const held = await ownCredential(project, name);
  if (held?.type !== "oauth_token") return undefined;
  const account = held.metadata?.["account"];
  return {
    account: typeof account === "string" ? account : undefined,
    signedOut: held.status !== "active",
  };
}

/** Starts a sign-in for the credential `name`, saved in `project` once the person signs in. */
export async function startSignIn(project: string, name: string) {
  return PluginSignInStarted.assert(
    await json(signIns(project), "POST", { credential: name }),
  );
}

export async function cancelSignIn(project: string, id: string) {
  return PluginSignInState.assert(
    await json(
      `${signIns(project)}/${encodeURIComponent(id)}/cancel`,
      "POST",
      {},
    ),
  );
}

/** Revokes the saved sign-in at its provider and in the project. */
export async function disconnectSignIn(project: string, name: string) {
  return PluginSignInDisconnected.assert(
    await json(`${signIns(project)}/disconnect`, "POST", { credential: name }),
  );
}

const POLL_MS = 1_000;
// The hub keeps a sign-in open for fifteen minutes.
export const SIGN_IN_DEADLINE_MS = 15 * 60 * 1000;

/** How a followed sign-in ended; "late" when the deadline passed while it was still open. */
export type SignInEnd =
  | Exclude<PluginSignInState, { status: "pending" }>
  | { status: "late" };

/**
 * Polls the sign-in's status every second until it ends or `deadline` passes. The person signs in
 * on the provider's tab, so this runs while Builder's tab is in the background. Aborting `signal`
 * stops the polling and throws, as a cancelled call does.
 */
export async function followSignIn(
  project: string,
  id: string,
  options: {
    deadline: number;
    signal: AbortSignal;
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
  },
): Promise<SignInEnd> {
  const now = options.now ?? Date.now;
  const sleep =
    options.sleep ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  for (;;) {
    options.signal.throwIfAborted();
    const state = PluginSignInState.assert(
      await json(
        `${signIns(project)}/${encodeURIComponent(id)}`,
        "GET",
        undefined,
      ),
    );
    if (state.status !== "pending") return state;
    if (now() >= options.deadline) return { status: "late" };
    await sleep(POLL_MS);
  }
}
