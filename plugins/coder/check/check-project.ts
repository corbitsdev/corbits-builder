// check-project: checks a project that is not a web app the way it ships: checks its bun.lock is
// current and runs its typecheck, test and build scripts, each whatever came before, and ends with
// the checklist of RULES, each passed or failed with what failed it. Exits non-zero when any fails.
import { failedScript, staleLockfile } from "./steps.ts";

if (process.argv[2] === "--help" || process.argv[2] === "-h") {
  console.log(
    "check-project   check bun.lock and run the project's typecheck, test and build scripts here",
  );
  process.exit(0);
}

const RULES = [
  {
    kind: "lockfile",
    rule: "bun.lock matches the package.json files",
    run: staleLockfile,
  },
  {
    kind: "typecheck",
    rule: "bun run typecheck passes",
    run: () => failedScript("typecheck"),
  },
  {
    kind: "test",
    rule: "bun run test passes",
    run: () => failedScript("test"),
  },
  {
    kind: "build",
    rule: "bun run build passes",
    run: () => failedScript("build"),
  },
];

const failures = new Map<string, string>();
for (const { kind, run } of RULES) {
  const failed = await run();
  if (failed !== undefined) failures.set(kind, failed);
}

console.log(
  failures.size
    ? `check failed: ${failures.size} problem(s)`
    : "check passed: typechecked, tested and built",
);
for (const { kind, rule } of RULES) {
  const failed = failures.get(kind);
  console.log(`${failed === undefined ? "✓" : "✗"} ${rule}`);
  if (failed !== undefined)
    console.log(failed.trimEnd().replace(/^/gm, "    "));
}
process.exit(failures.size ? 1 : 0);
