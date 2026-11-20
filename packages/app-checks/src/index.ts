import { readFileSync } from "node:fs";
import { join } from "node:path";

const CHECK = join(import.meta.dir, "..", "check");
const read = (file: string) => readFileSync(join(CHECK, file), "utf8");

export const checkScript = (name: "check-app" | "check-serverless"): string =>
  read(`${name}.ts`);

// The module the checks share, by the path they import it from once each is compiled on its own.
export const checkModules = (): Record<string, string> => ({
  "/steps.ts": read("steps.ts"),
});
