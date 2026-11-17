import { join } from "node:path";

// A macro runs inside Bun's bundler, so bundling its dependencies needs a separate process.
export function coderScript(name: "check-stack" | "watch-page"): string {
  const built = Bun.spawnSync([
    process.execPath,
    "--no-env-file",
    "build",
    join(import.meta.dir, "..", "check", `${name}.ts`),
    "--target=bun",
  ]);
  if (built.exitCode !== 0) throw new Error(built.stderr.toString());
  return built.stdout.toString();
}
