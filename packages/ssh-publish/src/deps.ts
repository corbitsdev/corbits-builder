import { cappedBytes, runHub } from "@corbits-builder/plugin/run-hub";
import { fixedTools, type ToolEnv } from "@corbits-builder/plugin/tools";
import { release, status, type Deps } from "./release.ts";

const MAX_RUNTIME_BYTES = 256 * 1024 * 1024;
// A slower download would leave a first release too little of its time limit to build in.
const RUNTIME_DOWNLOAD_MS = 2 * 60_000;
const OUTSIDE_TRIES = 3;
const OUTSIDE_WAIT_MS = 3_000;

// Any HTTP response counts: this only checks that the server is reachable on port 80.
async function answersFromOutside(url: string, signal: AbortSignal) {
  for (let tried = 1; ; tried++) {
    try {
      await fetch(url, {
        redirect: "manual",
        signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
      });
      return true;
    } catch (error) {
      if (signal.aborted) throw error;
      if (tried === OUTSIDE_TRIES) return false;
      await Bun.sleep(OUTSIDE_WAIT_MS);
    }
  }
}

/**
 * The deps fixedTools passes a tool call. They reach the server through the plugin's ssh credential
 * named `credential`.
 */
export const sshReleaseDeps =
  (credential: string) =>
  (env: ToolEnv, role: string, signal: AbortSignal): Deps => ({
    server: async () => {
      const server = await env.capabilities
        .resolve("credentials")
        .resolve(credential);
      if (server.kind !== "ssh")
        throw new Error(`${credential} is not a server key`);
      return server;
    },
    hub: runHub(env.capabilities, role, signal),
    answersFromOutside: (url) => answersFromOutside(url, signal),
    download: async (url) => {
      const response = await fetch(url, {
        signal: AbortSignal.any([
          signal,
          AbortSignal.timeout(RUNTIME_DOWNLOAD_MS),
        ]),
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`runtime_download_${response.status}`);
      }
      return cappedBytes(response, MAX_RUNTIME_BYTES);
    },
    now: () => new Date(),
    signal,
  });

/** A tool the model reads: its name and what it is told the tool does. */
type Named = { name: string; description: string };

/**
 * The publish tools for a target that publishes over SSH. One publishes the saved app and records
 * the release under `target`; the other says whether the app is up. Each takes its name and
 * description from the plugin, and reaches the server through the plugin's ssh credential named
 * `credential`.
 */
export const sshReleaseTools = (options: {
  // The tool package's id, as Interchange names its consumer.
  id: string;
  target: string;
  credential: string;
  release: Named;
  status: Named;
}) =>
  fixedTools<Deps>({
    id: options.id,
    credentials: [options.credential],
    tools: {
      [options.release.name]: {
        description: options.release.description,
        run: (deps) => release(options.target, deps),
      },
      [options.status.name]: {
        description: options.status.description,
        run: status,
      },
    },
    deps: sshReleaseDeps(options.credential),
  });
