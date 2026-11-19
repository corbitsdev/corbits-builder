import { runHub } from "@corbits-builder/plugin/run-hub";
import type { ToolEnv } from "@corbits-builder/plugin/tools";
import { digitalOcean } from "./api.ts";
import { makeHostKey } from "./host-key.ts";
import type { Deps } from "./provision.ts";
import { CREDENTIAL } from "./target.ts";

/** The Deps for one call of the create, status or remove tools. */
export const provisionDeps = (
  env: ToolEnv,
  role: string,
  signal: AbortSignal,
): Deps => ({
  vendor: digitalOcean({
    capabilities: env.capabilities,
    handle: CREDENTIAL,
    signal,
    sleep: (ms) => Bun.sleep(ms),
  }),
  hub: runHub(env.capabilities, role, signal),
  clock: { now: () => performance.now(), sleep: (ms) => Bun.sleep(ms) },
  now: () => new Date(),
  hostKey: makeHostKey,
  signal,
});
