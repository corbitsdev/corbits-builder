import { fileURLToPath } from "node:url";

const sourceFiles = [
  "apps/hub/src/app.ts",
  "apps/hub/src/middleware/correlation.ts",
  "apps/hub/src/auth/agent-token-bridge.ts",
  "apps/hub/src/projects/authorization.ts",
] as const;
const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));

// Never emit error-supplied filenames, messages, causes, or custom names.
export function requestErrorMetadata(error: unknown) {
  const errorType =
    [TypeError, ReferenceError, RangeError, SyntaxError].find(
      (known) => error instanceof known,
    )?.name ?? (error instanceof Error ? "Error" : "UnknownError");
  const errorLocations: string[] = [];
  if (
    error instanceof Error &&
    typeof error.stack === "string" &&
    error.stack.length <= 8192
  ) {
    for (const line of error.stack.split("\n").slice(1, 21)) {
      if (line.length > 512) continue;
      const frame =
        /^ {0,8}at (?:[^()\r\n]{1,80} \()?(.+):([1-9]\d{0,5}):([1-9]\d{0,4})\)?$/.exec(
          line,
        );
      if (frame === null) continue;
      const source = sourceFiles.find(
        (file) => repositoryRoot + file === frame[1],
      );
      if (source === undefined) continue;
      errorLocations.push(`${source}:${frame[2]}:${frame[3]}`);
      // Eight fixed filenames with bounded decimal coordinates stay below 1 KiB.
      if (errorLocations.length === 8) break;
    }
  }
  return { errorType, errorLocations };
}
