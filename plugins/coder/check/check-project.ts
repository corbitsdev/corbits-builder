// check-project: checks a project that is not a web app the way it ships: runs its typecheck, test
// and build scripts, each whatever came before, and ends with the checklist of RULES, each passed or
// failed with what failed it. Exits non-zero when any fails.
import { failedScript } from "./steps.ts";

if (process.argv[2] === "--help" || process.argv[2] === "-h") {
  console.log(
    "check-project   run the project's typecheck, test and build scripts here",
  );
  process.exit(0);
}

const RULES = [
  { script: "typecheck", rule: "bun run typecheck passes" },
  { script: "test", rule: "bun run test passes" },
  { script: "build", rule: "bun run build passes" },
];

const failures = new Map<string, string>();
for (const { script } of RULES) {
  const failed = await failedScript(script);
  if (failed !== undefined) failures.set(script, failed);
}

console.log(
  failures.size
    ? `check failed: ${failures.size} problem(s)`
    : "check passed: typechecked, tested and built",
);
for (const { script, rule } of RULES) {
  const failed = failures.get(script);
  console.log(`${failed === undefined ? "✓" : "✗"} ${rule}`);
  if (failed !== undefined)
    console.log(failed.trimEnd().replace(/^/gm, "    "));
}
process.exit(failures.size ? 1 : 0);
