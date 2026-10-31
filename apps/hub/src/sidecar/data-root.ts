/** Local sidecar state root. Never a launch-specific coding directory. */
export function localSidecarDataRoot(hubDataDir: string): string {
  return `${hubDataDir}/local-sidecars`;
}
