import { resolve } from "node:path";

/**
 * Local sidecar state root. Never a launch-specific coding directory.
 *
 * Absolute because sidecars run with `vendor/interchange` as their working
 * directory; a relative root would put their state there instead of beside the
 * hub's.
 */
export function localSidecarDataRoot(hubDataDir: string): string {
  return resolve(hubDataDir, "local-sidecars");
}
