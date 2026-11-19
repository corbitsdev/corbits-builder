import { isUnboundCredentialError } from "@intx/types";
import type { RuntimeCapabilities } from "@intx/types/runtime-capabilities";
import { BuilderUnavailable, runHub } from "@corbits-builder/plugin/run-hub";
import type { ToolEnv } from "@corbits-builder/plugin/tools";
import type { Fetch } from "./api.ts";
import type { Deps } from "./cloudflare.ts";
import { CREDENTIAL } from "./target.ts";

const VISIT_TIMEOUT_MS = 10_000;

// The saved key's fetch, or undefined when the person saved none.
async function keyOf(
  capabilities: RuntimeCapabilities,
): Promise<Fetch | undefined> {
  let credential;
  try {
    credential = await capabilities.resolve("credentials").resolve(CREDENTIAL);
  } catch (error) {
    if (isUnboundCredentialError(error)) return undefined;
    throw new BuilderUnavailable({ cause: error });
  }
  if (credential.kind !== "http") throw new BuilderUnavailable();
  return (url, init) => credential.fetch(url, init);
}

async function visit(url: string, signal: AbortSignal) {
  try {
    const response = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.any([signal, AbortSignal.timeout(VISIT_TIMEOUT_MS)]),
    });
    await response.body?.cancel();
    return response.status;
  } catch (error) {
    if (signal.aborted) throw error;
    return undefined;
  }
}

/** The deps one call of any Cloudflare tool gets, in the publish and remove tools alike. */

export const cloudflareDeps = (
  env: ToolEnv,
  role: string,
  signal: AbortSignal,
): Deps => ({
  hub: runHub(env.capabilities, role, signal),
  key: () => keyOf(env.capabilities),
  fetch: (url, init) => fetch(url, init),
  visit: (url) => visit(url, signal),
  sleep: (ms) => Bun.sleep(ms),
  now: () => new Date(),
  signal,
});
