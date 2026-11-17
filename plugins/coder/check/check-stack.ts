// check-stack: every coder's finish check. Runs each command CHECKS.txt lists, in order, the same
// commands Builder's builds check runs on the saved code; then each Builder check the starter lists in
// BUILDER-CHECKS.txt, such as a web app's check-app, which exist only in this workspace and so stay
// out of the saved list. Stops at the first that fails, with its output. Exits non-zero when one
// fails or CHECKS.txt lists none.
import { failedCommand } from "@corbits-builder/app-checks/steps";

const FILE = "CHECKS.txt";
const BUILDER_FILE = "BUILDER-CHECKS.txt";
// run_shell stops a command at 120 s, and check-app crawls until this time so the run ends with a
// verdict whatever the project's own commands took.
const DEADLINE = Date.now() + 100_000;

if (process.argv[2] === "--help" || process.argv[2] === "-h") {
  console.log(
    `check-stack   run each command in ${FILE}, then each in ${BUILDER_FILE}, in order, stopping at the first that fails`,
  );
  process.exit(0);
}

const lines = async (path: string) => {
  const listed = Bun.file(path);
  return (await listed.exists())
    ? (await listed.text())
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line !== "")
    : [];
};

const own = await lines(FILE);
if (own.length === 0) {
  console.log(
    `check failed: ${FILE} lists no commands. Write the commands that prove the project installs, builds and passes its tests into ${FILE} at the workspace root, one per line, in the order they run.`,
  );
  process.exit(1);
}
const commands = [...own, ...(await lines(BUILDER_FILE))];

for (const [step, command] of commands.entries()) {
  const failed = await failedCommand(["/bin/sh", "-c", command], {
    CHECK_STACK_DEADLINE: String(DEADLINE),
  });
  if (failed === undefined) continue;
  console.log(`check failed: ${command} exited non-zero`);
  for (const passed of commands.slice(0, step)) console.log(`✓ ${passed}`);
  console.log(`✗ ${command}`);
  if (failed.trim()) console.log(failed.trimEnd().replace(/^/gm, "    "));
  const skipped = commands.slice(step + 1);
  if (skipped.length) console.log(`did not run: ${skipped.join(", then ")}`);
  process.exit(1);
}
console.log(
  `check passed: every command in ${FILE} succeeded${commands.length > own.length ? `, then every check in ${BUILDER_FILE}` : ""}`,
);
for (const command of commands) console.log(`✓ ${command}`);
